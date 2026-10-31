// V63: pure-JS vector store. Replaces LanceDB (which depends on a
// platform-specific N-API binding that `bun --compile` cross-compile
// can't satisfy). For typical brain.md vaults (<10k chunks) brute-
// force cosine over Float32Array is well under 10ms — fast enough that
// "real database" overhead would be slower.
//
// On-disk format:
//   <vault>/.brain/vectors.json  ← debounced write, JSON for "open in
//                                  any editor + diffable" parity with
//                                  the rest of the vault.
// Schema mirrors the previous LanceDB row layout so the public RagStore
// API stays identical and RagPipeline / queries.ts don't change.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  EmbeddedChunk,
  EmbeddedTaskChunk,
  ProviderId,
  SearchHit,
  TaskHit,
} from "./types";

export type TaskDoneFilter = "open" | "done" | "all";

// Internal persisted shape — Float32Array doesn't JSON-serialise, so
// embeddings live as plain number arrays on disk.
interface NoteRowDisk {
  id: string;
  path: string;
  chunkIndex: number;
  text: string;
  embedding: number[];
  headingTrail: string[];
  lineStart: number;
  lineEnd: number;
  mtime: number;
  modelId: string;
  providerId: ProviderId;
}
interface TaskRowDisk {
  id: string;
  path: string;
  lineNo: number;
  text: string;
  done: boolean;
  embedding: number[];
  mtime: number;
  modelId: string;
  providerId: ProviderId;
}
interface StoreFile {
  version: 1;
  dim: number;
  providerId?: ProviderId;
  modelId?: string;
  endpoint?: string;
  incompatible?: boolean;
  notes: NoteRowDisk[];
  tasks: TaskRowDisk[];
}

export interface EmbeddingConfig {
  providerId: ProviderId;
  modelId: string;
  dim: number;
  // openai-compat only: the base URL rows were embedded against. Without
  // this, switching endpoints (e.g. Ollama → another host) while keeping
  // the same model name and dim isn't detected as a config change, so
  // queries compare vectors from two different embedders as if they were
  // compatible.
  endpoint?: string;
}

function chunkToDisk(r: EmbeddedChunk): NoteRowDisk {
  return {
    id: r.id,
    path: r.path,
    chunkIndex: r.chunkIndex,
    text: r.text,
    embedding: Array.from(r.embedding),
    headingTrail: r.headingTrail,
    lineStart: r.lineStart,
    lineEnd: r.lineEnd,
    mtime: r.mtime,
    modelId: r.modelId,
    providerId: r.providerId,
  };
}
function taskToDisk(r: EmbeddedTaskChunk): TaskRowDisk {
  return {
    id: r.id,
    path: r.path,
    lineNo: r.lineNo,
    text: r.text,
    done: r.done,
    embedding: Array.from(r.embedding),
    mtime: r.mtime,
    modelId: r.modelId,
    providerId: r.providerId,
  };
}

function cosineL2Normalised(a: Float32Array, b: number[]): number {
  // Both vectors are L2-normalised (LocalEmbedderWasm + OpenAI-compat
  // both normalise) so the dot product IS the cosine similarity.
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return Math.max(0, Math.min(1, (dot + 1) / 2)); // map [-1, 1] → [0, 1]
}

export class RagStore {
  private notes = new Map<string, NoteRowDisk>();
  private tasks = new Map<string, TaskRowDisk>();
  private opened = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  // V63: writeFile is sync to avoid races during reindex bursts; the
  // 200ms debounce hides the cost from a write storm.

  // V-concurrency #23: the provider/model/dim these rows were embedded
  // under. `open()`'s dim check only catches a changed dim across a
  // restart, switching provider/model at runtime (settings PATCH →
  // RagPipeline.applyConfig) without changing `dim` left old rows in the
  // store that silently mixed with new ones, or produced NaN scores when
  // a later dim change didn't match old rows' embedding length. Tracked
  // separately from the constructor's fixed `dim` so a mismatch can be
  // reported instead of corrupting comparisons.
  private expectedConfig: EmbeddingConfig | null = null;
  private incompatible = false;

  // `dim` starts as the caller's best guess (the currently configured
  // provider's dim at construction time) but gets corrected from whatever
  // vectors.json actually contains once open() reads it, see open() below.
  constructor(
    public readonly dir: string,
    public dim: number,
  ) {}

  // Called by RagPipeline whenever the active embedder config is set
  // (construction, settings change). If it actually changed from what was
  // expected before, rows already in the store were embedded under the old
  // config and can't be compared against new query vectors until a full
  // reindex rewrites them.
  setExpectedConfig(cfg: EmbeddingConfig): void {
    const prev = this.expectedConfig;
    this.expectedConfig = cfg;
    if (
      prev &&
      (prev.providerId !== cfg.providerId ||
        prev.modelId !== cfg.modelId ||
        prev.dim !== cfg.dim ||
        prev.endpoint !== cfg.endpoint)
    ) {
      this.incompatible = true;
      // Persist immediately: this flag is the only record that the rows
      // on disk no longer match the configured embedder. Leaving it to
      // the next upsert's debounced write would lose it on a restart
      // before any write happens.
      if (this.opened) this.scheduleWrite();
    }
  }

  getExpectedConfig(): EmbeddingConfig | null {
    return this.expectedConfig;
  }

  // Called once reindexAll has rewritten every row under `cfg`.
  markRebuilt(cfg: EmbeddingConfig): void {
    this.expectedConfig = cfg;
    this.dim = cfg.dim;
    this.incompatible = false;
    this.scheduleWrite();
  }

  // Refuses vector queries against a store whose rows no longer match the
  // active embedder, with a message that says what to do, instead of
  // comparing incompatible vectors (NaN scores) or mixing old and new rows.
  checkQueryable(): void {
    if (this.incompatible) {
      throw new Error(
        "RAG index was embedded with a different provider/model than is now configured; run a full reindex before querying.",
      );
    }
  }

  private filePath(): string {
    return join(this.dir, "vectors.json");
  }

  async open(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const file = this.filePath();
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as StoreFile;
        if (raw.version === 1) {
          // The constructor's `dim` is only a guess (the default provider's
          // dim at app startup, before settings.load() has run). Trust what
          // the file actually holds instead of wiping on a mismatch against
          // that guess, otherwise a vault whose configured embedder uses a
          // non-default dim loses its whole index on every restart. A real
          // mismatch against the *currently selected* embedder is caught
          // separately by setExpectedConfig()/checkQueryable() below, once
          // the pipeline applies the loaded settings.
          this.dim = raw.dim;
          for (const n of raw.notes) this.notes.set(n.id, n);
          for (const t of raw.tasks) this.tasks.set(t.id, t);
          if (raw.providerId && raw.modelId) {
            this.expectedConfig = {
              providerId: raw.providerId,
              modelId: raw.modelId,
              dim: raw.dim,
              endpoint: raw.endpoint,
            };
          }
          // Without persisting this, a restart forgets that rows were left
          // behind by a provider switch; setExpectedConfig() on the next
          // boot sees no *change* (expectedConfig starts matching what's
          // on disk) and queries happily mix old and new embeddings.
          this.incompatible = raw.incompatible ?? false;
        }
      } catch (e) {
        console.warn(
          `[rag] failed to parse vectors.json (${e instanceof Error ? e.message : String(e)}) — starting fresh.`,
        );
      }
    }
    this.opened = true;
  }

  async ensureOpen(): Promise<void> {
    if (this.opened) return;
    await this.open();
  }

  private requireOpen(): void {
    if (!this.opened)
      throw new Error("RagStore not opened (call open() first)");
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flushSync(), 200);
  }

  private flushSync(): void {
    if (!this.opened) return;
    mkdirSync(dirname(this.filePath()), { recursive: true });
    const payload: StoreFile = {
      version: 1,
      dim: this.dim,
      providerId: this.expectedConfig?.providerId,
      modelId: this.expectedConfig?.modelId,
      endpoint: this.expectedConfig?.endpoint,
      incompatible: this.incompatible,
      notes: [...this.notes.values()],
      tasks: [...this.tasks.values()],
    };
    writeFileSync(this.filePath(), JSON.stringify(payload));
    this.writeTimer = null;
  }

  // ---------------- notes ----------------

  async upsert(rows: EmbeddedChunk[]): Promise<void> {
    if (rows.length === 0) return;
    this.requireOpen();
    for (const r of rows) this.notes.set(r.id, chunkToDisk(r));
    this.scheduleWrite();
  }

  async deleteByPath(path: string): Promise<void> {
    this.requireOpen();
    let changed = false;
    for (const [id, r] of this.notes) {
      if (r.path === path) {
        this.notes.delete(id);
        changed = true;
      }
    }
    if (changed) this.scheduleWrite();
  }

  async search(vector: Float32Array, k: number): Promise<SearchHit[]> {
    this.requireOpen();
    this.checkQueryable();
    const scored: Array<{ r: NoteRowDisk; score: number }> = [];
    for (const r of this.notes.values()) {
      // Defensive even with checkQueryable() above: a row embedded at a
      // different dimension would index past its own array and compute
      // NaN rather than a sentinel low score.
      if (r.embedding.length !== vector.length) continue;
      scored.push({ r, score: cosineL2Normalised(vector, r.embedding) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ r, score }) => ({
      path: r.path,
      chunkIndex: r.chunkIndex,
      score,
      snippet: r.text,
      headingTrail: r.headingTrail,
      lineStart: r.lineStart,
      lineEnd: r.lineEnd,
    }));
  }

  async countAll(): Promise<number> {
    this.requireOpen();
    return this.notes.size;
  }

  // Every distinct note path currently represented in the store (body
  // chunks or tasks), used to reconcile a full reindex against the vault's
  // actual notes so deleted-folder subtrees don't linger forever.
  async distinctPaths(): Promise<string[]> {
    this.requireOpen();
    const seen = new Set<string>();
    for (const r of this.notes.values()) seen.add(r.path);
    for (const r of this.tasks.values()) seen.add(r.path);
    return [...seen];
  }

  async distinctProviderModel(): Promise<
    Array<{ providerId: ProviderId; modelId: string }>
  > {
    this.requireOpen();
    const seen = new Set<string>();
    const out: Array<{ providerId: ProviderId; modelId: string }> = [];
    for (const r of this.notes.values()) {
      const key = `${r.providerId}|${r.modelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ providerId: r.providerId, modelId: r.modelId });
    }
    return out;
  }

  // ---------------- tasks (V55) ----------------

  async upsertTasks(rows: EmbeddedTaskChunk[]): Promise<void> {
    if (rows.length === 0) return;
    this.requireOpen();
    for (const r of rows) this.tasks.set(r.id, taskToDisk(r));
    this.scheduleWrite();
  }

  async deleteTasksByPath(path: string): Promise<void> {
    this.requireOpen();
    let changed = false;
    for (const [id, r] of this.tasks) {
      if (r.path === path) {
        this.tasks.delete(id);
        changed = true;
      }
    }
    if (changed) this.scheduleWrite();
  }

  async searchTasks(
    vector: Float32Array,
    k: number,
    filter: TaskDoneFilter = "open",
  ): Promise<TaskHit[]> {
    this.requireOpen();
    this.checkQueryable();
    const scored: Array<{ r: TaskRowDisk; score: number }> = [];
    for (const r of this.tasks.values()) {
      if (filter === "open" && r.done) continue;
      if (filter === "done" && !r.done) continue;
      if (r.embedding.length !== vector.length) continue;
      scored.push({ r, score: cosineL2Normalised(vector, r.embedding) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(({ r, score }) => ({
      path: r.path,
      lineNo: r.lineNo,
      text: r.text,
      done: r.done,
      score,
    }));
  }

  async countTasks(): Promise<number> {
    this.requireOpen();
    return this.tasks.size;
  }

  async close(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.flushSync();
    }
    this.notes.clear();
    this.tasks.clear();
    this.opened = false;
  }
}
