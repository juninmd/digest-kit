import { describe, expect, test } from "bun:test";
import { createStore } from "../src/store.ts";
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
});
