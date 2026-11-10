import type { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

export interface VectorMatch {
  id: string;
  distance: number;
}

/** How `distance` is computed. `cosine` is the usual choice for text embeddings. */
export type VectorDistanceMetric = "l2" | "cosine" | "l1";

export interface VectorStoreOptions {
  tableName?: string;
  dimensions: number;
  /** Defaults to `l2` (Euclidean), the sqlite-vec default. Fixed when the table is created. */
  distanceMetric?: VectorDistanceMetric;
}

export type Embedding = Float32Array | number[];

export interface VectorEntry {
  id: string;
  embedding: Embedding;
}

export interface VectorStore {
  upsert(id: string, embedding: Embedding): void;
  /** Writes every entry in one transaction: all of them land, or none. */
  upsertMany(entries: readonly VectorEntry[]): void;
  search(embedding: Embedding, limit?: number): VectorMatch[];
  hasSimilar(embedding: Embedding, distanceThreshold: number): boolean;
  delete(id: string): void;
  count(): number;
}

const METRICS: readonly VectorDistanceMetric[] = ["l2", "cosine", "l1"];

/**
 * Loads the sqlite-vec extension into the SQLite database instance.
 * Returns true if successful, or false if not available/supported.
 */
export function loadSqliteVec(db: Database): boolean {
  try {
    sqliteVec.load(db);
    return true;
  } catch {
    return false;
  }
}

/** The metric an existing vec0 table was created with, read back from its DDL. */
function storedMetric(db: Database, tableName: string): VectorDistanceMetric | null {
  const row = db
    .query<{ sql: string }, [string]>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  if (!row) return null;
  const declared = /distance_metric\s*=\s*(\w+)/i.exec(row.sql)?.[1]?.toLowerCase();
  return (declared as VectorDistanceMetric | undefined) ?? "l2";
}

/**
 * Creates or initializes a vector store backed by sqlite-vec in SQLite.
 * Enables zero-external-dependency semantic search, KNN similarity and deduplication.
 */
export function createVectorStore(db: Database, options: VectorStoreOptions): VectorStore {
  const { tableName = "vec_items", dimensions, distanceMetric = "l2" } = options;
  if (!dimensions || dimensions <= 0) {
    throw new Error("VectorStore requires positive dimensions");
  }

  // Validate table name to prevent SQL injection in DDL
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }
  // Also interpolated into the DDL, so it gets the same allowlist treatment.
  if (!METRICS.includes(distanceMetric)) {
    throw new Error(`Invalid distance metric: ${distanceMetric}`);
  }

  const loaded = loadSqliteVec(db);
  if (!loaded) {
    throw new Error("Failed to load sqlite-vec extension into Database");
  }

  // CREATE ... IF NOT EXISTS would silently keep the old metric and every
  // distance (and threshold) would mean something else than the caller asked for.
  const existing = storedMetric(db, tableName);
  if (existing && existing !== distanceMetric) {
    throw new Error(
      `Vector table "${tableName}" already uses distance metric "${existing}", not "${distanceMetric}"`,
    );
  }

  const column =
    distanceMetric === "l2"
      ? `embedding float[${dimensions}]`
      : `embedding float[${dimensions}] distance_metric=${distanceMetric}`;
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(id TEXT PRIMARY KEY, ${column});`);

  const insertStmt = db.prepare<unknown, [string, Float32Array]>(
    `INSERT INTO ${tableName}(id, embedding) VALUES (?, ?)`,
  );
  const updateStmt = db.prepare<unknown, [Float32Array, string]>(
    `UPDATE ${tableName} SET embedding = ? WHERE id = ?`,
  );
  const deleteStmt = db.prepare<unknown, [string]>(`DELETE FROM ${tableName} WHERE id = ?`);
  const searchStmt = db.prepare<VectorMatch, [Float32Array, number]>(
    `SELECT id, distance FROM ${tableName} WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
  );
  const countStmt = db.prepare<{ count: number }, []>(`SELECT count(*) as count FROM ${tableName}`);

  const toFloat32Array = (embedding: Embedding): Float32Array => {
    if (embedding.length !== dimensions) {
      throw new Error(`Embedding dimension mismatch: expected ${dimensions}, got ${embedding.length}`);
    }
    return embedding instanceof Float32Array ? embedding : new Float32Array(embedding);
  };

  // vec0 has no UPSERT clause. Updating in place and inserting only when no row
  // matched keeps each call to a single write: the previous delete-then-insert
  // was two commits, and a failed insert left the row deleted.
  const replace = (id: string, vector: Float32Array): void => {
    if (updateStmt.run(vector, id).changes === 0) insertStmt.run(id, vector);
  };
  // One commit (one sync to disk) for the whole batch, and all-or-nothing.
  const replaceMany = db.transaction((rows: { id: string; vector: Float32Array }[]) => {
    for (const row of rows) replace(row.id, row.vector);
  });

  const search = (embedding: Embedding, limit = 5): VectorMatch[] =>
    searchStmt.all(toFloat32Array(embedding), limit);

  return {
    upsert(id: string, embedding: Embedding): void {
      replace(id, toFloat32Array(embedding));
    },

    upsertMany(entries: readonly VectorEntry[]): void {
      // Validate everything before opening the transaction: a bad row rejects the whole batch.
      const rows = entries.map((entry) => ({ id: entry.id, vector: toFloat32Array(entry.embedding) }));
      if (rows.length) replaceMany(rows);
    },

    search,

    hasSimilar(embedding: Embedding, distanceThreshold: number): boolean {
      // Calls the closure, not `this.search`: the method keeps working when destructured.
      const nearest = search(embedding, 1)[0];
      return nearest !== undefined && nearest.distance <= distanceThreshold;
    },

    delete(id: string): void {
      deleteStmt.run(id);
    },

    count(): number {
      return countStmt.get()?.count ?? 0;
    },
  };
}
