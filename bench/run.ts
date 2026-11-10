// Reproducible benchmark of the library's hot paths. No network, deterministic fixtures.
//
//   bun run bench                      # print the table
//   bun run bench --json out.json      # also save the raw numbers
//   bun run bench --filter store       # only cases whose name contains "store"
//
// Everything is imported through the public entry point, so the same file
// measures any revision of `src/` and two runs can be compared directly.

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { cpus, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import Parser from "rss-parser";
import {
  clean,
  createAgent,
  createStore,
  createVectorStore,
  defineTopic,
  extractArticleFromHtml,
  extractJsonObject,
  formatItems,
  hasEnglishSentence,
  idFor,
  isPollutedProse,
  isSafeExternalUrl,
  looksGarbled,
  splitMessage,
  type Agent,
  type Store,
  type VectorStore,
} from "../src/index.ts";
import {
  articlePage,
  createRandom,
  embedding,
  feedItems,
  htmlBody,
  modelAnswer,
  prose,
  rssXml,
} from "./fixtures.ts";
import {
  type BenchCase,
  type BenchResult,
  DEFAULT_OPTIONS,
  formatDuration,
  runCase,
} from "./harness.ts";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const jsonPath = flag("--json");
const filter = flag("--filter");
const options = { ...DEFAULT_OPTIONS, samples: Number(flag("--samples") ?? DEFAULT_OPTIONS.samples) };

const scratch = mkdtempSync(join(tmpdir(), "digest-kit-bench-"));
let fileSeq = 0;
const nextDbPath = () => join(scratch, `bench-${fileSeq++}.db`);

function expect(condition: unknown, message: string): void {
  if (!condition) throw new Error(`benchmark fixture check failed: ${message}`);
}

// ---------------------------------------------------------------- fixtures

const random = createRandom(20260820);

/**
 * Hands out a different input on every call. A benchmark that feeds one
 * constant string to a pure function measures the JIT folding the call away
 * (a 4 KB regex scan "takes" 4 ns), not the function.
 */
function cycle<T>(count: number, make: (index: number) => T): () => T {
  const pool = Array.from({ length: count }, (_, i) => make(i));
  let next = 0;
  return () => {
    if (next === pool.length) next = 0;
    return pool[next++]!;
  };
}

const snippet = prose(random, 280);
const snippets = cycle(32, () => prose(random, 280));
const html2k = cycle(32, () => htmlBody(random, 2_000));
const html64k = cycle(8, () => htmlBody(random, 64_000));
const text64k = cycle(8, () => prose(random, 64_000));
const prose4k = cycle(32, () => prose(random, 4_000));
const links = cycle(64, (i) => `https://example.com/noticias/${i * 7919}?utm_source=rss`);
const digest16k = cycle(8, () =>
  Array.from({ length: 60 }, (_, i) => `*${i + 1}.* ${prose(random, 250)}`).join("\n\n"),
);
const answerClean = cycle(16, () => modelAnswer(random, 0));
const answerBraces = cycle(16, () => modelAnswer(random, 12));
const strayBraces = cycle(16, () => `${prose(random, 1_500)} ${"{a} ".repeat(40)}${prose(random, 500)}`);
const page30k = cycle(4, () => articlePage(random, 30_000));
const fragment3k = cycle(8, () => `<article><h1>Título</h1>${htmlBody(random, 3_000)}</article>`);
const feedXml = rssXml(random, 50);
const urls = [
  "https://example.com/a/b?c=1",
  "https://sub.domain.example.org/path",
  "https://127.0.0.1/admin",
  "https://10.1.2.3/",
  "http://example.com/",
  "https://[2606:4700::1111]/",
  "https://service.internal/health",
  "https://169.254.169.254/latest/meta-data",
];
const digestItems = cycle(8, () =>
  Array.from({ length: 12 }, (_, i) => ({
    source: `Feed ${i % 4}`,
    title: prose(random, 70),
    summary: prose(random, 480),
    link: `https://example.com/noticias/${i}`,
  })),
);

const FEEDS = 20;
const ITEMS_PER_FEED = 50;
const topic = defineTopic({
  name: "bench",
  title: "Bench",
  emoji: "⏱",
  subject: "benchmark",
  systemPrompt: "n/a",
  feeds: Array.from({ length: FEEDS }, (_, i) => ({
    name: `Feed ${i}`,
    url: `https://feed${i}.example.com/rss`,
  })),
});
const itemsByFeed = new Map(
  topic.feeds.map((feed, i) => [feed.name, feedItems(random, i, ITEMS_PER_FEED)]),
);

function benchAgent(store: Store): Agent {
  return createAgent(topic, {
    config: { dbPath: ":memory:", maxItemsPerFeed: ITEMS_PER_FEED },
    store,
    fetchFeed: async (feed) => itemsByFeed.get(feed.name) ?? [],
    chat: async () => "ok",
    send: async () => {},
    now: () => new Date("2026-08-20T12:00:00Z"),
    log: () => {},
  });
}

const DIMENSIONS = 384;
const vectors = Array.from({ length: 5_000 }, () => embedding(random, DIMENSIONS));
const queryVector = embedding(random, DIMENSIONS);

interface VectorCtx {
  db: Database;
  store: VectorStore;
}

/** Newer revisions expose a batch write; older ones only have the per-row call. */
function storeEmbeddings(store: VectorStore, count: number): void {
  const batch = (store as { upsertMany?: (rows: { id: string; embedding: Float32Array }[]) => void })
    .upsertMany;
  if (batch) {
    batch(vectors.slice(0, count).map((v, i) => ({ id: `doc-${i}`, embedding: v })));
    return;
  }
  for (let i = 0; i < count; i++) store.upsert(`doc-${i}`, vectors[i]!);
}

function vectorCtx(path: string, rows: number): VectorCtx {
  const db = new Database(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  const store = createVectorStore(db, { dimensions: DIMENSIONS });
  if (rows) {
    db.transaction(() => {
      for (let i = 0; i < rows; i++) store.upsert(`doc-${i}`, vectors[i]!);
    })();
  }
  return { db, store };
}

// ------------------------------------------------------------------- cases

// `any`: each case owns its own context type.
const cases: BenchCase<any>[] = [
  // text
  { name: "text.clean: 280-char plain snippet", run: () => clean(snippets()) },
  { name: "text.clean: 2 KB HTML body", run: () => clean(html2k()) },
  { name: "text.clean: 64 KB HTML body", run: () => clean(html64k()) },
  { name: "text.clean: 64 KB plain text (full-content feed)", run: () => clean(text64k()) },
  { name: "text.idFor: one link", run: () => idFor(links()) },
  { name: "text.formatItems: 12 items", run: () => formatItems(digestItems()) },
  { name: "text.splitMessage: 16 KB digest", run: () => splitMessage(digest16k()) },

  // json
  { name: "json.extractJsonObject: fenced JSON in prose", run: () => extractJsonObject(answerClean()) },
  {
    name: "json.extractJsonObject: fenced JSON + 12 braces in trailing prose",
    setup: () => expect(extractJsonObject(answerBraces())?.startsWith("{"), "JSON not found"),
    run: () => extractJsonObject(answerBraces()),
  },
  { name: "json.extractJsonObject: no JSON, 40 stray braces", run: () => extractJsonObject(strayBraces()) },

  // prose
  { name: "prose.hasEnglishSentence: 4 KB pt-BR", run: () => hasEnglishSentence(prose4k()) },
  { name: "prose.looksGarbled: 4 KB pt-BR", run: () => looksGarbled(prose4k()) },
  { name: "prose.isPollutedProse: 4 KB pt-BR", run: () => isPollutedProse(prose4k()) },

  // net
  {
    name: "net.isSafeExternalUrl: 8 URLs",
    run: () => {
      let safe = 0;
      for (const url of urls) if (isSafeExternalUrl(url)) safe++;
      return safe;
    },
  },

  // extract
  {
    name: "extract.extractArticleFromHtml: 30 KB article page",
    setup: () => expect((extractArticleFromHtml(page30k())?.charCount ?? 0) > 20_000, "article too short"),
    run: () => extractArticleFromHtml(page30k()),
  },
  {
    name: "extract.extractArticleFromHtml: 3 KB fragment",
    setup: () => expect(extractArticleFromHtml(fragment3k()), "fragment not extracted"),
    run: () => extractArticleFromHtml(fragment3k()),
  },

  // feeds (third-party parser, measured for context: it is part of every ingest)
  {
    name: "feeds.parse (rss-parser): 50-item RSS, 190 KB",
    setup: () => new Parser(),
    run: (parser: Parser) => parser.parseString(feedXml),
  },

  // agent + store
  {
    name: `agent.ingest: ${FEEDS} feeds x ${ITEMS_PER_FEED} new items (:memory:)`,
    setup: () => ({ agent: undefined as Agent | undefined }),
    beforeEach: (ctx: { agent?: Agent }) => {
      ctx.agent?.close();
      ctx.agent = benchAgent(createStore(":memory:"));
    },
    run: async (ctx: { agent?: Agent }) => {
      const added = await ctx.agent!.ingest();
      expect(added === FEEDS * ITEMS_PER_FEED, `ingested ${added}`);
    },
    teardown: (ctx: { agent?: Agent }) => ctx.agent?.close(),
  },
  {
    name: `agent.ingest: ${FEEDS} feeds x ${ITEMS_PER_FEED} new items (file DB, WAL)`,
    setup: () => ({ agent: undefined as Agent | undefined }),
    beforeEach: (ctx: { agent?: Agent }) => {
      ctx.agent?.close();
      ctx.agent = benchAgent(createStore(nextDbPath()));
    },
    run: async (ctx: { agent?: Agent }) => {
      const added = await ctx.agent!.ingest();
      expect(added === FEEDS * ITEMS_PER_FEED, `ingested ${added}`);
    },
    teardown: (ctx: { agent?: Agent }) => ctx.agent?.close(),
  },
  {
    name: `agent.ingest: ${FEEDS} feeds x ${ITEMS_PER_FEED} items already stored (:memory:)`,
    setup: async () => {
      const agent = benchAgent(createStore(":memory:"));
      await agent.ingest();
      return agent;
    },
    run: (agent: Agent) => agent.ingest(),
    teardown: (agent: Agent) => agent.close(),
  },
  {
    name: `agent.ingest: ${FEEDS} feeds x ${ITEMS_PER_FEED} items already stored (file DB, WAL)`,
    setup: async () => {
      const agent = benchAgent(createStore(nextDbPath()));
      await agent.ingest();
      return agent;
    },
    run: (agent: Agent) => agent.ingest(),
    teardown: (agent: Agent) => agent.close(),
  },
  {
    name: "store.pendingItems(12): 50k rows, 1k pending",
    setup: () => {
      const store = createStore(":memory:");
      const ids: string[] = [];
      for (let i = 0; i < 50_000; i++) {
        const hour = String(i % 24).padStart(2, "0");
        const day = String(1 + (Math.floor(i / 24) % 28)).padStart(2, "0");
        store.insertItem({
          id: idFor(`https://example.com/${i}`),
          title: `Título ${i}`,
          link: `https://example.com/${i}`,
          source: `Feed ${i % 20}`,
          summary: snippet,
          published: null,
          fetched_at: `2026-08-${day}T${hour}:00:00.000Z`,
        });
        if (i % 50 !== 0) ids.push(idFor(`https://example.com/${i}`));
      }
      store.markDigested(ids);
      expect(store.pendingItems(2_000).length === 1_000, "expected 1000 pending rows");
      return store;
    },
    run: (store: Store) => store.pendingItems(12),
    teardown: (store: Store) => store.close(),
  },
  {
    name: "store.markDigested: 12 ids (100k rows, :memory:)",
    setup: () => {
      const store = createStore(":memory:");
      const ids: string[] = [];
      for (let i = 0; i < 100_000; i++) {
        const id = `sent-${i}`;
        ids.push(id);
        store.insertItem({
          id,
          title: `Título ${i}`,
          link: `https://example.com/${id}`,
          source: "Feed",
          summary: snippet,
          published: null,
          fetched_at: `2026-07-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00.000Z`,
        });
      }
      store.markDigested(ids);
      return { store, seq: 0, ids: [] as string[] };
    },
    beforeEach: (ctx: { store: Store; seq: number; ids: string[] }) => {
      ctx.ids = [];
      for (let i = 0; i < 12; i++) {
        const id = `pending-${ctx.seq++}`;
        ctx.ids.push(id);
        ctx.store.insertItem({
          id,
          title: "t",
          link: `https://example.com/${id}`,
          source: "Feed",
          summary: null,
          published: null,
          fetched_at: "2026-08-20T10:00:00.000Z",
        });
      }
    },
    run: (ctx: { store: Store; ids: string[] }) => ctx.store.markDigested(ctx.ids),
    teardown: (ctx: { store: Store }) => ctx.store.close(),
  },

  // vector
  {
    name: `vector: store 500 x ${DIMENSIONS}d embeddings (:memory:)`,
    setup: () => ({ current: undefined as VectorCtx | undefined }),
    beforeEach: (ctx: { current?: VectorCtx }) => {
      ctx.current?.db.close();
      ctx.current = vectorCtx(":memory:", 0);
    },
    run: (ctx: { current?: VectorCtx }) => storeEmbeddings(ctx.current!.store, 500),
    teardown: (ctx: { current?: VectorCtx }) => ctx.current?.db.close(),
  },
  {
    name: `vector: store 200 x ${DIMENSIONS}d embeddings (file DB, WAL)`,
    setup: () => ({ current: undefined as VectorCtx | undefined }),
    beforeEach: (ctx: { current?: VectorCtx }) => {
      ctx.current?.db.close();
      ctx.current = vectorCtx(nextDbPath(), 0);
    },
    run: (ctx: { current?: VectorCtx }) => storeEmbeddings(ctx.current!.store, 200),
    teardown: (ctx: { current?: VectorCtx }) => ctx.current?.db.close(),
  },
  {
    name: `vector.upsert: replace one ${DIMENSIONS}d row (1k rows, :memory:)`,
    setup: () => vectorCtx(":memory:", 1_000),
    run: (ctx: VectorCtx) => ctx.store.upsert("doc-500", queryVector),
    teardown: (ctx: VectorCtx) => ctx.db.close(),
  },
  {
    name: `vector.search k=5: 5k x ${DIMENSIONS}d`,
    setup: () => {
      const ctx = vectorCtx(":memory:", 5_000);
      expect(ctx.store.search(queryVector, 5).length === 5, "expected 5 matches");
      return ctx;
    },
    run: (ctx: VectorCtx) => ctx.store.search(queryVector, 5),
    teardown: (ctx: VectorCtx) => ctx.db.close(),
  },
  {
    name: `vector.hasSimilar: 5k x ${DIMENSIONS}d`,
    setup: () => vectorCtx(":memory:", 5_000),
    run: (ctx: VectorCtx) => ctx.store.hasSimilar(queryVector, 0.2),
    teardown: (ctx: VectorCtx) => ctx.db.close(),
  },
];

// --------------------------------------------------------------------- run

const selected = filter ? cases.filter((c) => c.name.includes(filter)) : cases;
const results: BenchResult[] = [];
const width = Math.max(...selected.map((c) => c.name.length));

console.log(`digest-kit benchmark — bun ${Bun.version}, ${cpus()[0]?.model ?? "unknown CPU"}`);
console.log(`${"case".padEnd(width)}  ${"median".padStart(10)}  ${"min".padStart(10)}  spread`);
try {
  for (const c of selected) {
    const result = await runCase(c, options);
    results.push(result);
    console.log(
      `${result.name.padEnd(width)}  ${formatDuration(result.medianNs).padStart(10)}  ${formatDuration(result.minNs).padStart(10)}  ±${(result.spread * 100).toFixed(1)}%`,
    );
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (jsonPath) {
  const report = {
    runtime: `bun ${Bun.version}`,
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    options,
    results,
  };
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nsaved ${jsonPath}`);
}
