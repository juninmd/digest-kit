import cron from "node-cron";
import { createChat } from "./ai.ts";
import { loadConfig } from "./config.ts";
import { createFetchFeed } from "./feeds.ts";
import { createStore } from "./store.ts";
import { createSend } from "./telegram.ts";
import { clean, formatItems, idFor } from "./text.ts";
import type { Agent, AgentDeps, Config, Topic } from "./types.ts";

/** Só valida o que o consumidor escreve à mão e ajuda o TS a inferir. */
export function defineTopic(topic: Topic): Topic {
  if (!topic.feeds.length) throw new Error(`topic "${topic.name}": nenhum feed configurado`);
  return topic;
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
    const results = await Promise.allSettled(
      topic.feeds.map(async (feed) => {
        const items = (await fetchFeed(feed)).slice(0, config.maxItemsPerFeed);
        let added = 0;
        for (const it of items) {
          const link = it.link ?? "";
          const title = it.title?.trim() ?? "";
          if (!link || !title) continue;
          const isNew = store.insertItem({
            id: idFor(link),
            title,
            link,
            source: feed.name,
            summary: clean(it.contentSnippet ?? it.content) || null,
            published: it.isoDate ?? it.pubDate ?? null,
            fetched_at: fetchedAt,
          });
          if (isNew) added++;
        }
        return { name: feed.name, added };
      }),
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

  async function digest(): Promise<string | null> {
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

    await send(message);
    store.markDigested(items.map((it) => it.id));
    log(`[digest] enviado com ${items.length} itens`);
    return message;
  }

  async function runOnce(): Promise<void> {
    await ingest();
    await digest();
  }

  function startLoop(): () => void {
    log(`[${topic.name}] agente ativo`);
    log(`  ingestão: ${config.cronIngestion}`);
    log(`  digest:   ${config.cronDigest}`);
    const tasks = [
      cron.schedule(config.cronIngestion, () => {
        ingest().catch((e) => log(`[ingest] erro: ${e}`));
      }),
      cron.schedule(config.cronDigest, () => {
        digest().catch((e) => log(`[digest] erro: ${e}`));
      }),
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
    close: () => store.close(),
  };
}

/**
 * CLI padrão dos agentes: `--ingest`, `--digest`, `--loop`, ou um ciclo único.
 * É o corpo inteiro do `src/index.ts` de um agente consumidor.
 */
export async function runAgent(
  topic: Topic,
  deps: AgentDeps = {},
  argv: string[] = process.argv.slice(2),
): Promise<void> {
  const args = new Set(argv);
  const agent = createAgent(topic, deps);

  if (args.has("--ingest")) {
    await agent.ingest();
  } else if (args.has("--digest")) {
    await agent.digest();
  } else if (args.has("--loop")) {
    await agent.ingest();
    agent.startLoop();
    return; // fica de pé; não fecha o store
  } else {
    await agent.runOnce();
  }
  agent.close();
}
