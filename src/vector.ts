import type { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";

export interface VectorMatch {
  id: string;
  distance: number;
}

export interface VectorStoreOptions {
  tableName?: string;
  dimensions: number;
}

export interface VectorStore {
  upsert(id: string, embedding: Float32Array | number[]): void;
  search(embedding: Float32Array | number[], limit?: number): VectorMatch[];
  hasSimilar(embedding: Float32Array | number[], distanceThreshold: number): boolean;
  delete(id: string): void;
  count(): number;
}

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

/**
 * Creates or initializes a vector store backed by sqlite-vec in SQLite.
 * Enables zero-external-dependency semantic search, KNN similarity and deduplication.
 */
export function createVectorStore(
  db: Database,
  options: VectorStoreOptions,
): VectorStore {
  const { tableName = "vec_items", dimensions } = options;
  if (!dimensions || dimensions <= 0) {
    throw new Error("VectorStore requires positive dimensions");
  }

  // Validate table name to prevent SQL injection in DDL
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error(`Invalid table name: ${tableName}`);
  }

  const loaded = loadSqliteVec(db);
  if (!loaded) {
    throw new Error("Failed to load sqlite-vec extension into Database");
  }

  db.run(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING vec0(id TEXT PRIMARY KEY, embedding float[${dimensions}]);`,
  );

  const insertStmt = db.prepare(
    `INSERT INTO ${tableName}(id, embedding) VALUES (?, ?)`,
  );
  const deleteStmt = db.prepare(
    `DELETE FROM ${tableName} WHERE id = ?`,
  );
  const searchStmt = db.prepare<VectorMatch, [Float32Array, number]>(
    `SELECT id, distance FROM ${tableName} WHERE embedding MATCH ? AND k = ? ORDER BY distance`,
  );
  const countStmt = db.prepare<{ count: number }, []>(
    `SELECT count(*) as count FROM ${tableName}`,
  );

  const toFloat32Array = (embedding: Float32Array | number[]): Float32Array => {
    if (embedding instanceof Float32Array) {
      if (embedding.length !== dimensions) {
        throw new Error(
          `Embedding dimension mismatch: expected ${dimensions}, got ${embedding.length}`,
        );
      }
      return embedding;
    }
    if (embedding.length !== dimensions) {
      throw new Error(
        `Embedding dimension mismatch: expected ${dimensions}, got ${embedding.length}`,
      );
    }
    return new Float32Array(embedding);
  };

  return {
    upsert(id: string, embedding: Float32Array | number[]): void {
      const vec = toFloat32Array(embedding);
      deleteStmt.run(id);
      insertStmt.run(id, vec);
    },

    search(embedding: Float32Array | number[], limit = 5): VectorMatch[] {
      const vec = toFloat32Array(embedding);
      return searchStmt.all(vec, limit);
    },

    hasSimilar(
      embedding: Float32Array | number[],
      distanceThreshold: number,
    ): boolean {
      const matches = this.search(embedding, 1);
      if (!matches.length) return false;
      return matches[0]!.distance <= distanceThreshold;
    },

    delete(id: string): void {
      deleteStmt.run(id);
    },

    count(): number {
      const row = countStmt.get();
      return row?.count ?? 0;
    },
  };
}
