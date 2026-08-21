import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { Item, NewItem, Store } from "./types.ts";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS items (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    link        TEXT NOT NULL,
    source      TEXT NOT NULL,
    summary     TEXT,
    published   TEXT,
    fetched_at  TEXT NOT NULL,
    digested    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_items_digested ON items(digested, fetched_at);
`;

/**
 * SQLite via bun:sqlite. `:memory:` é aceito (é o que os testes usam).
 * A deduplicação é o PRIMARY KEY: reprocessar o mesmo feed não gera item repetido.
 */
export function createStore(dbPath: string): Store {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO items (id, title, link, source, summary, published, fetched_at, digested)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const markOne = db.prepare<unknown, [string]>(
    "UPDATE items SET digested = 1 WHERE id = ?",
  );
  const markMany = db.transaction((ids: string[]) => {
    for (const id of ids) markOne.run(id);
  });

  return {
    insertItem(row: NewItem): boolean {
      const { changes } = insert.run(
        row.id,
        row.title,
        row.link,
        row.source,
        row.summary,
        row.published,
        row.fetched_at,
      );
      return changes > 0;
    },

    pendingItems(limit: number): Item[] {
      return db
        .query<Item, [number]>(
          "SELECT * FROM items WHERE digested = 0 ORDER BY fetched_at DESC LIMIT ?",
        )
        .all(limit);
    },

    markDigested(ids: string[]): void {
      if (!ids.length) return;
      markMany(ids);
    },

    close(): void {
      db.close();
    },
  };
}
