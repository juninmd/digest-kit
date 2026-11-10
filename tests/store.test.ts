import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/storage/store.ts";
import type { NewItem } from "../src/types.ts";

const row = (n: number, fetchedAt = "2026-08-20T10:00:00Z"): NewItem => ({
  id: `id-${n}`,
  title: `Título ${n}`,
  link: `https://x.example/${n}`,
  source: "Feed",
  summary: null,
  published: null,
  fetched_at: fetchedAt,
});

describe("store", () => {
  test("insere e devolve pendentes", () => {
    const s = createStore(":memory:");
    expect(s.insertItem(row(1))).toBe(true);
    expect(s.pendingItems(10)).toHaveLength(1);
    s.close();
  });

  test("insert do mesmo id é ignorado", () => {
    const s = createStore(":memory:");
    s.insertItem(row(1));
    expect(s.insertItem(row(1))).toBe(false);
    expect(s.pendingItems(10)).toHaveLength(1);
    s.close();
  });

  test("markDigested tira os itens da fila", () => {
    const s = createStore(":memory:");
    s.insertItem(row(1));
    s.insertItem(row(2));
    s.markDigested(["id-1"]);
    expect(s.pendingItems(10).map((i) => i.id)).toEqual(["id-2"]);
    s.close();
  });

  test("markDigested com lista vazia não explode", () => {
    const s = createStore(":memory:");
    expect(() => s.markDigested([])).not.toThrow();
    s.close();
  });

  test("pendentes vêm do mais recente para o mais antigo", () => {
    const s = createStore(":memory:");
    s.insertItem(row(1, "2026-08-19T10:00:00Z"));
    s.insertItem(row(2, "2026-08-20T10:00:00Z"));
    expect(s.pendingItems(10).map((i) => i.id)).toEqual(["id-2", "id-1"]);
    s.close();
  });

  test("respeita o limite", () => {
    const s = createStore(":memory:");
    for (let i = 0; i < 5; i++) s.insertItem(row(i));
    expect(s.pendingItems(3)).toHaveLength(3);
    s.close();
  });
  test("insertItems grava o lote e conta só os novos", () => {
    const s = createStore(":memory:");
    s.insertItem(row(1));
    // id 1 já existe; id 2 aparece duas vezes no mesmo lote.
    expect(s.insertItems([row(1), row(2), row(2), row(3)])).toBe(2);
    expect(s.insertItems([])).toBe(0);
    expect(s.pendingItems(10).map((i) => i.id).sort()).toEqual(["id-1", "id-2", "id-3"]);
    s.close();
  });

  test("insertItems é atômico: uma linha inválida desfaz o lote inteiro", () => {
    const s = createStore(":memory:");
    // Um valor que o SQLite não sabe ligar faz o INSERT lançar no meio do lote.
    const invalid = { ...row(9), title: { not: "a string" } } as unknown as NewItem;
    expect(() => s.insertItems([row(1), row(2), invalid])).toThrow();
    expect(s.pendingItems(10)).toHaveLength(0);
    s.close();
  });

  test("markDigested aceita lista grande e ids com aspas", () => {
    const s = createStore(":memory:");
    const rows = Array.from({ length: 3000 }, (_, n) => row(n));
    const odd = { ...row(0), id: `id-"aspas"-'simples'-\\` };
    s.insertItems([...rows, odd]);
    s.markDigested([...rows.map((r) => r.id), odd.id, "id-que-nao-existe"]);
    expect(s.pendingItems(10)).toHaveLength(0);
    expect(s.stats().digested).toBe(3001);
    s.close();
  });

  test("stats conta a fila e a última coleta", () => {
    const s = createStore(":memory:");
    expect(s.stats()).toEqual({ total: 0, pending: 0, digested: 0, lastFetchedAt: null });
    s.insertItems([row(1, "2026-08-19T10:00:00Z"), row(2, "2026-08-20T10:00:00Z"), row(3)]);
    s.markDigested(["id-1"]);
    expect(s.stats()).toEqual({
      total: 3,
      pending: 2,
      digested: 1,
      lastFetchedAt: "2026-08-20T10:00:00Z",
    });
    s.close();
  });
});

describe("store: esquema e migração", () => {
  const indexes = (path: string) => {
    const db = new Database(path);
    const names = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")
      .all()
      .map((r) => r.name);
    db.close();
    return names;
  };

  test("a consulta de pendentes usa o índice parcial", () => {
    const dir = mkdtempSync(join(tmpdir(), "digest-kit-store-"));
    const path = join(dir, "plan.db");
    createStore(path).close();
    const db = new Database(path);
    const plan = db
      .query<{ detail: string }, []>(
        "EXPLAIN QUERY PLAN SELECT * FROM items WHERE digested = 0 ORDER BY fetched_at DESC LIMIT 12",
      )
      .all()
      .map((r) => r.detail)
      .join(" | ");
    db.close();
    rmSync(dir, { recursive: true, force: true });
    expect(plan).toContain("idx_items_pending");
    expect(plan).not.toContain("TEMP B-TREE"); // a ordenação sai do índice
  });

  test("banco criado pela 0.4 é migrado sem perder itens nem estado", () => {
    const dir = mkdtempSync(join(tmpdir(), "digest-kit-store-"));
    const path = join(dir, "legacy.db");
    // Esquema exato da 0.4.0, com o índice cheio.
    const legacy = new Database(path, { create: true });
    legacy.exec(`
      CREATE TABLE items (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, link TEXT NOT NULL, source TEXT NOT NULL,
        summary TEXT, published TEXT, fetched_at TEXT NOT NULL, digested INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_items_digested ON items(digested, fetched_at);
      INSERT INTO items VALUES ('old-sent', 't', 'https://x/1', 'Feed', NULL, NULL, '2026-08-18T10:00:00Z', 1);
      INSERT INTO items VALUES ('old-pending', 't', 'https://x/2', 'Feed', NULL, NULL, '2026-08-19T10:00:00Z', 0);
    `);
    legacy.close();
    expect(indexes(path)).toEqual(["idx_items_digested"]);

    const s = createStore(path);
    expect(s.pendingItems(10).map((i) => i.id)).toEqual(["old-pending"]);
    expect(s.insertItem({ ...row(1), id: "old-sent" })).toBe(false); // continua deduplicado
    expect(s.stats()).toMatchObject({ total: 2, pending: 1, digested: 1 });
    s.close();
    expect(indexes(path)).toEqual(["idx_items_pending"]);

    // Reabrir é idempotente.
    createStore(path).close();
    expect(indexes(path)).toEqual(["idx_items_pending"]);
    rmSync(dir, { recursive: true, force: true });
  });
});
