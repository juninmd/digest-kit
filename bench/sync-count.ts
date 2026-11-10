// Workload for counting disk syncs, which a shared disk cannot make noisy the
// way it makes wall-clock time noisy. Linux only (needs strace):
//
//   strace -f -e trace=fsync,fdatasync,write -o trace.txt bun bench/sync-count.ts ingest
//   awk '/MARK-START/{on=1} /MARK-END/{on=0} on && /sync\(/{n++} END{print n+0}' trace.txt
//
// Modes: `ingest` (20 feeds x 50 new items into a file database) and
// `vector` (200 embeddings of 384 dimensions into a file database).
// The two write(2) markers bracket the measured region in the trace.

import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgent, createVectorStore, defineTopic } from "../src/index.ts";
import { createRandom, embedding, feedItems } from "./fixtures.ts";

const mode = process.argv[2];
if (mode !== "ingest" && mode !== "vector") {
  console.error("usage: bun bench/sync-count.ts <ingest|vector>");
  process.exit(2);
}

const random = createRandom(20260820);
const dir = mkdtempSync(join(tmpdir(), "digest-kit-sync-"));
const mark = (label: string) => writeSync(2, `${label}\n`);

try {
  if (mode === "ingest") {
    const topic = defineTopic({
      name: "sync-count",
      title: "Sync count",
      emoji: "⏱",
      subject: "benchmark",
      systemPrompt: "n/a",
      feeds: Array.from({ length: 20 }, (_, i) => ({ name: `Feed ${i}`, url: `https://feed${i}.example.com/rss` })),
    });
    const itemsByFeed = new Map(topic.feeds.map((feed, i) => [feed.name, feedItems(random, i, 50)]));
    const agent = createAgent(topic, {
      config: { dbPath: join(dir, "items.db"), maxItemsPerFeed: 50 },
      fetchFeed: async (feed) => itemsByFeed.get(feed.name) ?? [],
      chat: async () => "ok",
      send: async () => {},
      log: () => {},
    });
    mark("MARK-START");
    const added = await agent.ingest();
    mark(`MARK-END items=${added}`);
    agent.close();
  } else {
    const db = new Database(join(dir, "vectors.db"));
    db.exec("PRAGMA journal_mode = WAL;");
    const store = createVectorStore(db, { dimensions: 384 });
    const entries = Array.from({ length: 200 }, (_, i) => ({ id: `doc-${i}`, embedding: embedding(random, 384) }));
    // Revisions before upsertMany only have the per-row call.
    const batch = (store as { upsertMany?: (rows: typeof entries) => void }).upsertMany;
    mark("MARK-START");
    if (batch) batch(entries);
    else for (const entry of entries) store.upsert(entry.id, entry.embedding);
    mark(`MARK-END vectors=${store.count()}`);
    db.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
