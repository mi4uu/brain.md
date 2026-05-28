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
  notes: NoteRowDisk[];
  tasks: TaskRowDisk[];
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

  constructor(
    public readonly dir: string,
    public readonly dim: number,
  ) {}

  private filePath(): string {
    return join(this.dir, "vectors.json");
  }

  async open(): Promise<void> {
    mkdirSync(this.dir, { recursive: true });
    const file = this.filePath();
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as StoreFile;
        if (raw.version === 1 && raw.dim === this.dim) {
          for (const n of raw.notes) this.notes.set(n.id, n);
          for (const t of raw.tasks) this.tasks.set(t.id, t);
        } else {
          // Different dim → embeddings can't be reused. Wipe.
          console.warn(
            `[rag] vectors.json dim ${raw.dim} ≠ current ${this.dim} — wiping (reindex required).`,
          );
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
    const scored: Array<{ r: NoteRowDisk; score: number }> = [];
    for (const r of this.notes.values()) {
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
    const scored: Array<{ r: TaskRowDisk; score: number }> = [];
    for (const r of this.tasks.values()) {
      if (filter === "open" && r.done) continue;
      if (filter === "done" && !r.done) continue;
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
