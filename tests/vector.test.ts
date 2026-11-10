import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createVectorStore,
  loadSqliteVec,
} from "../src/storage/vector.ts";

describe("vector store", () => {
  test("loadSqliteVec loads extension successfully in Database", () => {
    const db = new Database(":memory:");
    expect(loadSqliteVec(db)).toBe(true);
    db.close();
  });

  test("createVectorStore initializes vec0 virtual table and rejects invalid options", () => {
    const db = new Database(":memory:");
    expect(() => createVectorStore(db, { dimensions: 0 })).toThrow(
      "VectorStore requires positive dimensions",
    );
    expect(() =>
      createVectorStore(db, { dimensions: 4, tableName: "invalid table name!" }),
    ).toThrow("Invalid table name");

    const store = createVectorStore(db, { dimensions: 4 });
    expect(store.count()).toBe(0);
    db.close();
  });

  test("upsert, count, and delete work correctly", () => {
    const db = new Database(":memory:");
    const store = createVectorStore(db, { dimensions: 4 });

    const v1 = [0.1, 0.2, 0.3, 0.4];
    store.upsert("doc1", v1);
    expect(store.count()).toBe(1);

    // Re-upserting doc1 updates the vector and keeps count at 1
    const v1Updated = [0.15, 0.25, 0.35, 0.45];
    store.upsert("doc1", v1Updated);
    expect(store.count()).toBe(1);

    store.upsert("doc2", [0.9, 0.8, 0.7, 0.6]);
    expect(store.count()).toBe(2);

    store.delete("doc1");
    expect(store.count()).toBe(1);
    expect(store.search(v1, 5).find((m) => m.id === "doc1")).toBeUndefined();

    db.close();
  });

  test("search finds nearest neighbors ordered by distance", () => {
    const db = new Database(":memory:");
    const store = createVectorStore(db, { dimensions: 3 });

    // Insert 3 vectors with known geometry
    store.upsert("itemA", [1.0, 0.0, 0.0]);
    store.upsert("itemB", [0.0, 1.0, 0.0]);
    store.upsert("itemC", [0.9, 0.1, 0.0]); // Very close to itemA

    const query = [1.0, 0.0, 0.0];
    const results = store.search(query, 2);

    expect(results.length).toBe(2);
    expect(results[0]?.id).toBe("itemA");
    expect(results[0]?.distance).toBeCloseTo(0, 4);

    expect(results[1]?.id).toBe("itemC");
    expect(results[1]?.distance).toBeGreaterThan(0);
    expect(results[1]?.distance).toBeLessThan(1.0);

    db.close();
  });

  test("hasSimilar detects duplicates within distance threshold", () => {
    const db = new Database(":memory:");
    const store = createVectorStore(db, { dimensions: 4 });

    store.upsert("article-1", [0.5, 0.5, 0.5, 0.5]);

    // Near identical vector
    const duplicate = [0.5, 0.5, 0.5, 0.51];
    expect(store.hasSimilar(duplicate, 0.05)).toBe(true);

    // Distant vector
    const distant = [0.1, -0.9, 0.2, -0.4];
    expect(store.hasSimilar(distant, 0.05)).toBe(false);

    db.close();
  });

  test("enforces dimension checks", () => {
    const db = new Database(":memory:");
    const store = createVectorStore(db, { dimensions: 4 });

    expect(() => store.upsert("err", [1, 2])).toThrow(
      "Embedding dimension mismatch: expected 4, got 2",
    );
    expect(() => store.search([1, 2, 3, 4, 5])).toThrow(
      "Embedding dimension mismatch: expected 4, got 5",
    );

    db.close();
  });
});
