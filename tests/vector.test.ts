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
    // The stored vector really changed: the new one is at distance 0, the old one is not.
    expect(store.search(v1Updated, 1)[0]?.distance).toBeCloseTo(0, 5);
    expect(store.search(v1, 1)[0]?.distance).toBeGreaterThan(0.05);

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
  test("upsertMany writes a batch and replaces existing ids", () => {
    const db = new Database(":memory:");
    const store = createVectorStore(db, { dimensions: 3 });
    store.upsert("a", [1, 0, 0]);

    store.upsertMany([
      { id: "a", embedding: [0, 1, 0] },
      { id: "b", embedding: new Float32Array([0, 0, 1]) },
      { id: "c", embedding: [1, 1, 0] },
    ]);

    expect(store.count()).toBe(3);
    const nearest = store.search([0, 1, 0], 1)[0];
    expect(nearest?.id).toBe("a");
    expect(nearest?.distance).toBeCloseTo(0, 5);

    store.upsertMany([]);
    expect(store.count()).toBe(3);
    db.close();
  });

  test("upsertMany is all-or-nothing when one embedding is invalid", () => {
    const db = new Database(":memory:");
    const store = createVectorStore(db, { dimensions: 3 });
    store.upsert("keep", [1, 0, 0]);

    expect(() =>
      store.upsertMany([
        { id: "keep", embedding: [0, 1, 0] },
        { id: "bad", embedding: [1, 2] },
      ]),
    ).toThrow("Embedding dimension mismatch: expected 3, got 2");

    expect(store.count()).toBe(1);
    // "keep" still holds its original vector: the batch never started.
    expect(store.search([1, 0, 0], 1)[0]?.distance).toBeCloseTo(0, 5);
    db.close();
  });

  test("cosine metric ignores vector length; l2 does not", () => {
    const db = new Database(":memory:");
    const cosine = createVectorStore(db, { dimensions: 2, tableName: "vec_cos", distanceMetric: "cosine" });
    const l2 = createVectorStore(db, { dimensions: 2, tableName: "vec_l2" });
    for (const store of [cosine, l2]) {
      store.upsert("same-direction", [10, 0]);
      store.upsert("orthogonal", [0, 1]);
    }

    const byCosine = cosine.search([1, 0], 2);
    expect(byCosine[0]?.id).toBe("same-direction");
    expect(byCosine[0]?.distance).toBeCloseTo(0, 5);
    expect(byCosine[1]?.distance).toBeCloseTo(1, 5);

    // Euclidean: [0,1] (distance √2) is closer to [1,0] than [10,0] (distance 9).
    const byL2 = l2.search([1, 0], 2);
    expect(byL2[0]?.id).toBe("orthogonal");
    expect(byL2[1]?.distance).toBeCloseTo(9, 4);

    expect(cosine.hasSimilar([3, 0], 0.01)).toBe(true);
    expect(l2.hasSimilar([3, 0], 0.01)).toBe(false);
    db.close();
  });

  test("l1 metric sums absolute differences", () => {
    const db = new Database(":memory:");
    const store = createVectorStore(db, { dimensions: 2, distanceMetric: "l1" });
    store.upsert("p", [3, 4]);
    expect(store.search([0, 0], 1)[0]?.distance).toBeCloseTo(7, 4);
    db.close();
  });

  test("rejects an unknown metric and a metric that differs from the existing table", () => {
    const db = new Database(":memory:");
    expect(() =>
      // @ts-expect-error not part of VectorDistanceMetric
      createVectorStore(db, { dimensions: 2, distanceMetric: "dot); DROP TABLE x; --" }),
    ).toThrow("Invalid distance metric");

    createVectorStore(db, { dimensions: 2, tableName: "vec_meta", distanceMetric: "cosine" });
    // Reopening with the same metric is fine.
    createVectorStore(db, { dimensions: 2, tableName: "vec_meta", distanceMetric: "cosine" });
    expect(() => createVectorStore(db, { dimensions: 2, tableName: "vec_meta" })).toThrow(
      'Vector table "vec_meta" already uses distance metric "cosine", not "l2"',
    );

    createVectorStore(db, { dimensions: 2, tableName: "vec_plain" });
    expect(() =>
      createVectorStore(db, { dimensions: 2, tableName: "vec_plain", distanceMetric: "cosine" }),
    ).toThrow('already uses distance metric "l2", not "cosine"');
    db.close();
  });

  test("methods keep working when destructured", () => {
    const db = new Database(":memory:");
    const { upsert, hasSimilar, search, count } = createVectorStore(db, { dimensions: 2 });
    upsert("a", [1, 0]);
    expect(count()).toBe(1);
    expect(search([1, 0])).toHaveLength(1);
    expect(hasSimilar([1, 0], 0.001)).toBe(true);
    db.close();
  });
});
