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
  NewItem,
  ParsedFeedItem,
  Store,
  Topic,
} from "../types.ts";
import { mapSettled, skipWhileRunning } from "../util/concurrency.ts";
import { clean, formatItems, idFor } from "../util/text.ts";
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
      id: idFor(link),
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

export function createAgent(topic: Topic, deps: AgentDeps = {}): Agent {
  const config: Config = loadConfig(deps.config);
  const log = deps.log ?? ((msg: string) => console.log(msg));
  const store = deps.store ?? createStore(config.dbPath);
  const chat = deps.chat ?? createChat(config);
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
    const items = store.pendingItems(config.digestMaxItems);
    if (!items.length) {
      log("[digest] nada novo para resumir");
      return null;
    }

    const list = formatItems(items);
    const user = `Itens coletados hoje sobre ${topic.subject}:\n\n${list}\n\nGere o digest diário em português do Brasil.`;

    let body: string;
    try {
      body = await chat(topic.systemPrompt, user);
      if (!body) throw new Error("resposta vazia");
    } catch (err) {
      // Falha de IA não pode custar o digest do dia: manda a lista crua.
      log(`[digest] IA falhou (${err}) — enviando lista bruta`);
      body = list;
    }

    const date = now().toLocaleDateString(config.locale, { timeZone: config.timezone });
    const message = `*${topic.emoji} ${topic.title} — ${date}*\n\n${body}`;

    if (dryRun) {
      log(`[digest] dry-run: nada enviado, itens continuam pendentes\n\n${message}`);
      return message;
    }

    await send(message);
    store.markDigested(items.map((it) => it.id));
    log(`[digest] enviado com ${items.length} itens`);
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
