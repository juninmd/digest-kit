import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Item, NewItem, SqliteStore, StoreStats } from "../types.ts";

/**
 * O índice é parcial: só as linhas pendentes entram nele. Itens já enviados
 * nunca mais são consultados por data, então indexá-los só fazia o arquivo
 * crescer e cada `markDigested` mover uma entrada em vez de apagar uma.
 * `idx_items_digested` é o índice cheio das versões até a 0.4.
 */
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
  CREATE INDEX IF NOT EXISTS idx_items_pending ON items(fetched_at) WHERE digested = 0;
  DROP INDEX IF EXISTS idx_items_digested;
`;

/**
 * SQLite via bun:sqlite. `:memory:` é aceito (é o que os testes usam).
 * A deduplicação é o PRIMARY KEY: reprocessar o mesmo feed não gera item repetido.
 */
export function createStore(dbPath: string): SqliteStore {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  // --ingest e --digest em processos separados disputam o mesmo arquivo: espera o lock.
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);

  const insert = db.prepare<unknown, [string, string, string, string, string | null, string | null, string]>(`
    INSERT OR IGNORE INTO items (id, title, link, source, summary, published, fetched_at, digested)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);
  const insertRow = (row: NewItem): boolean =>
    insert.run(row.id, row.title, row.link, row.source, row.summary, row.published, row.fetched_at)
      .changes > 0;
  // Fora de transação cada INSERT é um commit (e um fsync em disco): o lote paga um só.
  const insertBatch = db.transaction((rows: NewItem[]): number => {
    let added = 0;
    for (const row of rows) if (insertRow(row)) added++;
    return added;
  });

  // Um ingest grava todos os feeds com o mesmo fetched_at: sem desempate, o LIMIT corta
  // o lote ao acaso. published ISO ordena como texto; pubDate cru ou nulo vai para o fim.
  const pending = db.prepare<Item, [number]>(`
    SELECT * FROM items WHERE digested = 0
    ORDER BY fetched_at DESC,
             CASE WHEN published GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN published END DESC
    LIMIT ?
  `);
  // Um statement para a lista toda: json_each expande os ids dentro do SQLite.
  const markAll = db.prepare<unknown, [string]>(
    "UPDATE items SET digested = 1 WHERE id IN (SELECT value FROM json_each(?))",
  );
  // digested = 2: saiu da fila por idade, sem envio. Continua fora de `pending`.
  const expire = db.prepare<unknown, [string]>(
    "UPDATE items SET digested = 2 WHERE digested = 0 AND fetched_at < ?",
  );
  const known = db.prepare<{ id: string }, [string]>(
    "SELECT id FROM items WHERE id IN (SELECT value FROM json_each(?))",
  );
  const compact = db.prepare<unknown, [string]>(
    "UPDATE items SET summary = NULL WHERE digested != 0 AND summary IS NOT NULL AND fetched_at < ?",
  );
  const queueStats = db.prepare<Omit<StoreStats, "digested">, []>(`
    SELECT COUNT(*) AS total,
           (SELECT COUNT(*) FROM items WHERE digested = 0) AS pending,
           MAX(fetched_at) AS lastFetchedAt
    FROM items
  `);

  return {
    insertItem: insertRow,

    insertItems(rows: NewItem[]): number {
      return rows.length ? insertBatch(rows) : 0;
    },

    pendingItems(limit: number): Item[] {
      return pending.all(limit);
    },

    markDigested(ids: string[]): void {
      if (ids.length) markAll.run(JSON.stringify(ids));
    },

    knownIds(ids: string[]): Set<string> {
      return new Set(ids.length ? known.all(JSON.stringify(ids)).map((r) => r.id) : []);
    },

    expirePending(before: string): number {
      return expire.run(before).changes;
    },

    compactDigested(before: string): number {
      return compact.run(before).changes;
    },

    stats(): StoreStats {
      const row = queueStats.get() ?? { total: 0, pending: 0, lastFetchedAt: null };
      return { ...row, digested: row.total - row.pending };
    },

    close(): void {
      db.close();
    },
  };
}
