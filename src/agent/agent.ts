import cron from "node-cron";
import { createChat } from "../ai/chat.ts";
import { createSend } from "../delivery/telegram.ts";
import { createFetchFeed } from "../sources/feeds.ts";
import { createStore } from "../storage/store.ts";
import type {
  Agent,
  AgentDeps,
  Config,
  DigestOptions,
  Feed,
  Item,
  NewItem,
  ParsedFeedItem,
  Store,
  Topic,
} from "../types.ts";
import { mapSettled, skipWhileRunning } from "../util/concurrency.ts";
import { clean, formatItems, idFor, linkRefs, normalizeLink, titleKey } from "../util/text.ts";
import { DEFAULT_FEED_CONCURRENCY, loadConfig } from "./config.ts";

/** Só valida o que o consumidor escreve à mão e ajuda o TS a inferir. */
export function defineTopic(topic: Topic): Topic {
  if (!topic.feeds.length) throw new Error(`topic "${topic.name}": nenhum feed configurado`);
  return topic;
}

/** Itens de um feed no formato do banco; sem link ou sem título não há o que guardar. */
function toRows(items: ParsedFeedItem[], feed: Feed, fetchedAt: string): NewItem[] {
  const rows: NewItem[] = [];
  for (const item of items) {
    const link = item.link ?? "";
    const title = item.title?.trim() ?? "";
    if (!link || !title) continue;
    rows.push({
      // Mesmo artigo com utm_*, www. ou barra final não vira item novo.
      id: idFor(normalizeLink(link)),
      title,
      link,
      source: feed.name,
      summary: clean(item.contentSnippet ?? item.content) || null,
      published: item.isoDate ?? item.pubDate ?? null,
      fetched_at: fetchedAt,
    });
  }
  return rows;
}

/** Um lote por feed quando o store sabe gravar em lote; senão, linha a linha. */
function insertRows(store: Store, rows: NewItem[]): number {
  if (store.insertItems) return store.insertItems(rows);
  let added = 0;
  for (const row of rows) if (store.insertItem(row)) added++;
  return added;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Quantos pendentes são lidos para escolher o digest: sobra para o teto por fonte e duplicatas. */
const POOL_FACTOR = 5;

/**
 * Escolhe até `limit` itens do mais novo para o mais velho, com no máximo
 * `perSource` de cada fonte; a mesma manchete vinda de outro feed vira
 * duplicata. Se o teto por fonte deixar vaga, ela é preenchida com o que sobrou.
 */
export function selectDigestItems(
  pool: Item[],
  limit: number,
  perSource: number,
): { picked: Item[]; duplicates: Item[] } {
  const picked: Item[] = [];
  const overflow: Item[] = [];
  const duplicates: Item[] = [];
  const titles = new Set<string>();
  const perSourceCount = new Map<string, number>();
  for (const item of pool) {
    const key = titleKey(item.title);
    if (key && titles.has(key)) {
      duplicates.push(item);
      continue;
    }
    if (key) titles.add(key);
    const count = perSourceCount.get(item.source) ?? 0;
    if (picked.length < limit && count < perSource) {
      picked.push(item);
      perSourceCount.set(item.source, count + 1);
    } else {
      overflow.push(item);
    }
  }
  for (const item of overflow) {
    if (picked.length >= limit) break;
    picked.push(item);
  }
  // Duplicata de item que não entrou continua pendente: ela pode ser a única cópia no próximo digest.
  const pickedTitles = new Set(picked.map((it) => titleKey(it.title)));
  return { picked, duplicates: duplicates.filter((it) => pickedTitles.has(titleKey(it.title))) };
}

export function createAgent(topic: Topic, deps: AgentDeps = {}): Agent {
  const config: Config = loadConfig(deps.config);
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const store = deps.store ?? createStore(config.dbPath);
  const chat =
    deps.chat ??
    createChat(config, {
      onUsage: (u) => log(`[ai] ${u.model}: ${u.inputTokens} tokens de entrada, ${u.outputTokens} de saída`),
    });
  const send = deps.send ?? createSend(config, log);
  const fetchFeed = deps.fetchFeed ?? createFetchFeed(config);
  const now = deps.now ?? (() => new Date());

  async function ingest(): Promise<number> {
    const fetchedAt = now().toISOString();
    const results = await mapSettled(
      topic.feeds,
      async (feed) => {
        const items = (await fetchFeed(feed)).slice(0, config.maxItemsPerFeed);
        return { name: feed.name, added: insertRows(store, toRows(items, feed, fetchedAt)) };
      },
      config.feedConcurrency ?? DEFAULT_FEED_CONCURRENCY,
    );

    let total = 0;
    for (const [i, r] of results.entries()) {
      if (r.status === "fulfilled") {
        total += r.value.added;
        if (r.value.added) log(`  + ${r.value.added} de ${r.value.name}`);
      } else {
        // Um feed fora do ar não pode derrubar o ciclo inteiro.
        log(`  ! feed "${topic.feeds[i]?.name}" falhou: ${r.reason}`);
      }
    }
    log(`[ingest] ${total} itens novos`);
    return total;
  }

  async function digest({ dryRun = false }: DigestOptions = {}): Promise<string | null> {
    const ttlHours = config.pendingTtlHours ?? 48;
    if (!dryRun && ttlHours > 0 && store.expirePending) {
      // Sem isso a fila só cresce: o digest pega os mais novos e os antigos ficam para sempre.
      const expired = store.expirePending(new Date(now().getTime() - ttlHours * HOUR_MS).toISOString());
      if (expired) log(`[digest] ${expired} pendentes com mais de ${ttlHours}h saíram da fila`);
    }

    const pool = store.pendingItems(config.digestMaxItems * POOL_FACTOR);
    const { picked: items, duplicates } = selectDigestItems(
      pool,
      config.digestMaxItems,
      config.maxItemsPerSource ?? 4,
    );
    if (!items.length) {
      log("[digest] nada novo para resumir");
      return null;
    }

    const refs = config.digestLinkRefs ?? true;
    const list = formatItems(items, { links: !refs });
    const cite = refs
      ? "\n\nCite a fonte de cada item só com o número dele entre colchetes, ex.: [3]. Não escreva URLs."
      : "";
    const user = `Itens coletados hoje sobre ${topic.subject}:\n\n${list}\n\nGere o digest diário em português do Brasil.${cite}`;

    let body: string;
    try {
      body = await chat(topic.systemPrompt, user);
      if (!body) throw new Error("resposta vazia");
      if (refs) body = linkRefs(body, items);
    } catch (err) {
      // Falha de IA não pode custar o digest do dia: manda a lista crua.
      log(`[digest] IA falhou (${err}) — enviando lista bruta`);
      body = formatItems(items);
    }

    const date = now().toLocaleDateString(config.locale, { timeZone: config.timezone });
    const message = `*${topic.emoji} ${topic.title} — ${date}*\n\n${body}`;

    if (dryRun) {
      log(`[digest] dry-run: nada enviado, itens continuam pendentes\n\n${message}`);
      return message;
    }

    await send(message);
    store.markDigested([...items, ...duplicates].map((it) => it.id));
    log(
      `[digest] enviado com ${items.length} itens${duplicates.length ? ` (${duplicates.length} duplicados descartados)` : ""}`,
    );
    const retentionDays = config.retentionDays ?? 30;
    if (retentionDays > 0) store.compactDigested?.(new Date(now().getTime() - retentionDays * DAY_MS).toISOString());
    try {
      await deps.onDigest?.({ topic, message, items });
    } catch (e) {
      // O digest já foi entregue e marcado: o arquivamento é secundário.
      log(`[digest] onDigest falhou: ${e}`);
    }
    return message;
  }

  async function runOnce(options?: DigestOptions): Promise<void> {
    await ingest();
    await digest(options);
  }

  function startLoop(): () => void {
    log(`[${topic.name}] agente ativo`);
    log(`  ingestão: ${config.cronIngestion}`);
    log(`  digest:   ${config.cronDigest}`);
    // Um ciclo lento (feed travado, IA demorada) não pode ser atropelado pelo próximo
    // disparo do cron: dois digests simultâneos enviariam os mesmos itens duas vezes.
    const guarded = (name: string, task: () => Promise<unknown>) =>
      skipWhileRunning(
        () => task().catch((e) => log(`[${name}] erro: ${e}`)),
        () => log(`[${name}] execução anterior ainda em andamento — disparo ignorado`),
      );
    const tasks = [
      cron.schedule(config.cronIngestion, guarded("ingest", ingest)),
      cron.schedule(config.cronDigest, guarded("digest", digest)),
    ];
    return () => {
      for (const t of tasks) t.stop();
    };
  }

  return {
    topic,
    config,
    store,
    ingest,
    digest,
    runOnce,
    startLoop,
    status: () => store.stats?.() ?? null,
    close: () => store.close(),
  };
}
