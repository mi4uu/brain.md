import type { Vault, MutationEvent } from "../vault/vault";
import { chunkNote, chunkTasks } from "./chunker";
import { LocalEmbedderWasm as LocalEmbedder } from "./embedder-local-wasm";
import { OpenAICompatEmbedder } from "./embedder-openai";
import type { Embedder } from "./provider";
import { describeProvider } from "./provider";
import { RagStore } from "./store";
import type { EmbeddedChunk, EmbeddedTaskChunk, RagConfig } from "./types";

// V47 + V49: high-level RAG pipeline. Owns:
//   - one RagStore opened against <VAULT>/.brain/lance/
//   - one Embedder picked from settings.rag.{provider, local|openaiCompat}
//   - hooks into vault.onMutation so writes/deletes/renames flow into the store
//
// Cycle-free: store + embedder created per config; if settings change,
// caller calls applyConfig() which may rebuild the embedder (e.g., switching
// provider). The store stays the same; reindex happens lazily on next write
// or eagerly via reindexAll().

function makeEmbedder(cfg: RagConfig): Embedder {
  if (cfg.provider === "local") return new LocalEmbedder(cfg.local);
  return new OpenAICompatEmbedder(cfg.openaiCompat);
}

export class RagPipeline {
  private embedder: Embedder;
  private unsubscribe?: () => void;
  private indexing = new Map<string, Promise<void>>(); // path → in-flight job
  public lastIndexedAt: number | null = null;
  private cfg: RagConfig;

  constructor(
    private readonly vault: Vault,
    public readonly store: RagStore,
    cfg: RagConfig,
  ) {
    this.cfg = cfg;
    this.embedder = makeEmbedder(cfg);
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.vault.onMutation((e) => {
      void this.handleEvent(e);
    });
  }

  // V58: open the store + subscribe to mutations on demand. Safe to call
  // repeatedly. Required so toggling Enable RAG at runtime works without
  // a server restart — without this, settings.PATCH could flip the flag
  // but the store stayed closed → every indexNote() threw "not opened".
  async ensureRunning(): Promise<void> {
    await this.store.ensureOpen();
    this.start();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  applyConfig(cfg: RagConfig): void {
    // B17: always rebuild. Comparing only providerId+modelId missed baseURL,
    // apiKey, and dim changes — e.g. switching Ollama→OpenRouter on the same
    // openai-compat provider+model kept the old localhost:11434 URL and
    // every embed() failed with "Unable to connect". Embedder constructor
    // is cheap; the real warm-up cost is lazy in .ready() / first .embed().
    this.cfg = cfg;
    this.embedder = makeEmbedder(cfg);
    // Reset the cached probe error — old failures don't reflect new config.
    this.lastProbeError = null;
  }

  private async handleEvent(e: MutationEvent): Promise<void> {
    if (!this.cfg.enabled) return;
    if (!e.path.endsWith(".md")) return;
    try {
      switch (e.kind) {
        case "write":
          await this.indexNote(e.path);
          break;
        case "delete":
          await this.deleteNote(e.path);
          break;
        case "rename":
          // notify("rename", to, from) — extra holds the old path
          if (e.extra) await this.deleteNote(e.extra);
          await this.indexNote(e.path);
          break;
        default:
          return;
      }
    } catch (err) {
      // Errors here MUST NOT crash the vault loop; surface via logger and move on.
      console.warn(
        `[rag] index ${e.kind} ${e.path} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async indexNote(rel: string): Promise<void> {
    // Dedupe concurrent writes of the same path
    const existing = this.indexing.get(rel);
    if (existing) return existing;
    await this.store.ensureOpen();
    const job = this.indexOne(rel).finally(() => this.indexing.delete(rel));
    this.indexing.set(rel, job);
    return job;
  }

  private async indexOne(rel: string): Promise<void> {
    const note = await this.vault.readNote(rel);
    const chunks = chunkNote(rel, note.content);
    const tasks = chunkTasks(rel, note.content);
    const desc = describeProvider(this.cfg);

    // Always wipe prior rows for this path so removed content doesn't linger.
    await this.store.deleteByPath(rel);
    await this.store.deleteTasksByPath(rel);

    // Embed body chunks + task texts in a single batch so we pay the
    // embedder warm-up cost once per note.
    const bodyTexts = chunks.map((c) => c.text);
    const taskTexts = tasks.map((t) => t.text);
    const allVectors =
      bodyTexts.length + taskTexts.length === 0
        ? []
        : await this.embedder.embed([...bodyTexts, ...taskTexts]);

    if (chunks.length > 0) {
      const noteRows: EmbeddedChunk[] = chunks.map((c, i) => ({
        ...c,
        id: `${rel}#${c.chunkIndex}`,
        embedding: allVectors[i]!,
        mtime: note.mtime,
        modelId: desc.modelId,
        providerId: desc.providerId,
      }));
      await this.store.upsert(noteRows);
    }

    if (tasks.length > 0) {
      const offset = chunks.length;
      const taskRows: EmbeddedTaskChunk[] = tasks.map((t, i) => ({
        ...t,
        id: `${rel}#L${t.lineNo}`,
        embedding: allVectors[offset + i]!,
        mtime: note.mtime,
        modelId: desc.modelId,
        providerId: desc.providerId,
      }));
      await this.store.upsertTasks(taskRows);
    }

    this.lastIndexedAt = Date.now();
  }

  async deleteNote(rel: string): Promise<void> {
    await this.store.ensureOpen();
    await this.store.deleteByPath(rel);
    await this.store.deleteTasksByPath(rel);
  }

  // Public encode hook for ad-hoc queries (used by /api/similar).
  async embed(texts: string[]): Promise<Float32Array[]> {
    return this.embedder.embed(texts);
  }

  // V59: preflight probe. Used by Settings PATCH on Enable RAG, by
  // /api/rag/status for the "lastError" banner, and by the Test connection
  // button. Embedding "ping" is cheap when the model is already loaded and
  // surfaces native-dep failures (B14 onnxruntime) with one round trip.
  public lastProbeError: string | null = null;
  async probe(): Promise<{ ok: boolean; dim?: number; error?: string }> {
    try {
      const [v] = await this.embedder.embed(["ping"]);
      this.lastProbeError = null;
      return { ok: true, dim: v?.length ?? 0 };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.lastProbeError = msg;
      return { ok: false, error: msg };
    }
  }

  async reindexAll(): Promise<{ indexed: number; skipped: number; durationMs: number }> {
    const t0 = Date.now();
    await this.ensureRunning();
    const notes = await this.vault.listAllNotes();
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const rel of notes) {
      try {
        await this.indexNote(rel);
        indexed++;
      } catch (e) {
        skipped++;
        // V58: surface skip reasons — silent skips made debugging the
        // "Indexed 0 / 17 skipped" failure mode impossible.
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${rel}: ${msg}`);
        if (errors.length <= 5) console.warn(`[rag] skip ${rel}:`, msg);
        // V59: also bubble into lastProbeError so the UI banner reflects
        // bulk-reindex failures (most users won't hit "Test connection").
        this.lastProbeError = msg;
      }
    }
    if (errors.length > 0) {
      console.warn(`[rag] reindex skipped ${skipped} of ${notes.length}; first errors:`, errors.slice(0, 5));
    }
    return { indexed, skipped, durationMs: Date.now() - t0 };
  }
}
