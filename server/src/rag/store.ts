// LanceDB + apache-arrow are loaded lazily inside open() so the module
// can be imported safely even when the host doesn't have the native
// LanceDB binding available (e.g. inside a `bun --compile` binary where
// the platform-specific .node file isn't bundled). The penalty is one
// extra dynamic import on the first RAG mutation; the cost is amortised
// across the whole pipeline lifecycle.
//
// Types are imported with `import type` so they have no runtime cost.
import type * as lancedb from "@lancedb/lancedb";
import type { Schema } from "apache-arrow";
import type { EmbeddedChunk, SearchHit, ProviderId } from "./types";

// V47: per-vault LanceDB at <VAULT>/.brain/lance/, table notes_v1.
// Schema fixed at construction (dim must match embedder.dim). Mismatched
// stores after model swap force a full reindex (caller's job — flagged
// via /api/rag/status.needsReindex).

const TABLE_NAME = "notes_v1";

interface RowOut {
  id: string;
  path: string;
  chunk_index: number;
  text: string;
  embedding: number[]; // arrow gives back number[] for fixed-size-list
  heading_trail: string[];
  line_start: number;
  line_end: number;
  mtime: number;
  model_id: string;
  provider_id: string;
  _distance?: number;
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

// LanceDB returns list columns as Arrow Vector instances rather than plain
// JS arrays. Normalise to string[] for callers.
function toStringArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String);
  const vec = v as { toArray?: () => unknown[]; length?: number };
  if (typeof vec.toArray === "function") {
    return vec.toArray().map(String);
  }
  if (typeof vec.length === "number") {
    return Array.from(v as ArrayLike<unknown>).map(String);
  }
  return [];
}

function rowToWire(r: EmbeddedChunk): Record<string, unknown> {
  return {
    id: r.id,
    path: r.path,
    chunk_index: r.chunkIndex,
    text: r.text,
    embedding: Array.from(r.embedding),
    heading_trail: r.headingTrail,
    line_start: r.lineStart,
    line_end: r.lineEnd,
    mtime: r.mtime,
    model_id: r.modelId,
    provider_id: r.providerId,
  };
}

export class RagStore {
  private db?: lancedb.Connection;
  private table?: lancedb.Table;

  constructor(
    public readonly dir: string,
    public readonly dim: number,
  ) {}

  private async buildSchema(): Promise<Schema> {
    const arrow = await import("apache-arrow");
    return new arrow.Schema([
      new arrow.Field("id", new arrow.Utf8(), false),
      new arrow.Field("path", new arrow.Utf8(), false),
      new arrow.Field("chunk_index", new arrow.Int32(), false),
      new arrow.Field("text", new arrow.Utf8(), false),
      new arrow.Field(
        "embedding",
        new arrow.FixedSizeList(
          this.dim,
          new arrow.Field("item", new arrow.Float32(), true),
        ),
        false,
      ),
      new arrow.Field(
        "heading_trail",
        new arrow.List(new arrow.Field("item", new arrow.Utf8(), true)),
        true,
      ),
      new arrow.Field("line_start", new arrow.Int32(), false),
      new arrow.Field("line_end", new arrow.Int32(), false),
      new arrow.Field("mtime", new arrow.Float64(), false),
      new arrow.Field("model_id", new arrow.Utf8(), false),
      new arrow.Field("provider_id", new arrow.Utf8(), false),
    ]);
  }

  async open(): Promise<void> {
    // Load LanceDB (with its native binding) the first time the store is
    // actually opened, NOT at module load — see top-of-file comment.
    const lancedb = await import("@lancedb/lancedb");
    this.db = await lancedb.connect(this.dir);
    const names = await this.db.tableNames();
    if (names.includes(TABLE_NAME)) {
      this.table = await this.db.openTable(TABLE_NAME);
    } else {
      this.table = await this.db.createEmptyTable(
        TABLE_NAME,
        await this.buildSchema(),
      );
    }
  }

  private requireTable(): lancedb.Table {
    if (!this.table) throw new Error("RagStore not opened (call open() first)");
    return this.table;
  }

  async upsert(rows: EmbeddedChunk[]): Promise<void> {
    if (rows.length === 0) return;
    const t = this.requireTable();
    const wire = rows.map(rowToWire);
    await t
      .mergeInsert("id")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute(wire);
  }

  async deleteByPath(path: string): Promise<void> {
    const t = this.requireTable();
    await t.delete(`path = '${escapeSql(path)}'`);
  }

  async search(vector: Float32Array, k: number): Promise<SearchHit[]> {
    const t = this.requireTable();
    const rows = (await t
      .vectorSearch(Array.from(vector))
      .limit(k)
      .toArray()) as RowOut[];
    return rows.map((r) => ({
      path: r.path,
      chunkIndex: r.chunk_index,
      // LanceDB default metric for fixed-size float vectors is L2;
      // with L2-normalised embeddings, L2² = 2(1 - cos_sim), so
      // cos_sim = 1 - distance/2 → score ∈ [0, 1].
      score:
        typeof r._distance === "number"
          ? Math.max(0, Math.min(1, 1 - r._distance / 2))
          : 0,
      snippet: r.text,
      headingTrail: toStringArray(r.heading_trail),
      lineStart: r.line_start,
      lineEnd: r.line_end,
    }));
  }

  async countAll(): Promise<number> {
    const t = this.requireTable();
    return t.countRows();
  }

  async distinctProviderModel(): Promise<
    Array<{ providerId: ProviderId; modelId: string }>
  > {
    const t = this.requireTable();
    const rows = (await t
      .query()
      .select(["provider_id", "model_id"])
      .toArray()) as Array<{ provider_id: string; model_id: string }>;
    const seen = new Set<string>();
    const out: Array<{ providerId: ProviderId; modelId: string }> = [];
    for (const r of rows) {
      const key = `${r.provider_id}|${r.model_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ providerId: r.provider_id as ProviderId, modelId: r.model_id });
    }
    return out;
  }

  async close(): Promise<void> {
    this.table = undefined;
    this.db = undefined;
  }
}
