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

type PendingAction = "write" | "delete";

export class RagPipeline {
  private embedder: Embedder;
  private unsubscribe?: () => void;
  private jobs = new Map<string, Promise<void>>(); // path → in-flight job
  // V-concurrency #19: the action to rerun once the in-flight job for this
  // path finishes. An edit that lands mid-embed used to be silently dropped
  // (indexNote() just returned the existing promise); a delete that lands
  // mid-embed could lose the race and have the stale write's upsert
  // resurrect rows for a note that no longer exists. Recording the latest
  // desired action and rerunning it after the current job settles fixes
  // both: delete always wins if it's the last thing that happened.
  private pending = new Map<string, PendingAction>();
  public lastIndexedAt: number | null = null;
  private cfg: RagConfig;
  // Monotonic counter bumped every time a path is queued for write/delete,
  // and the sequence number each path was last queued at. reindexAll()'s
  // reconciliation pass uses this to tell "genuinely gone from the vault"
  // apart from "written concurrently with the reindex, after the vault
  // listing it diffs against was taken but before it diffed" — the latter
  // must not be deleted back out.
  private seq = 0;
  private touchedAt = new Map<string, number>();

  constructor(
    private readonly vault: Vault,
    public readonly store: RagStore,
    cfg: RagConfig,
  ) {
    this.cfg = cfg;
    this.embedder = makeEmbedder(cfg);
    this.store.setExpectedConfig(describeProvider(cfg));
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
    this.store.setExpectedConfig(describeProvider(cfg));
    // Reset the cached probe error — old failures don't reflect new config.
    this.lastProbeError = null;
  }

  private async handleEvent(e: MutationEvent): Promise<void> {
    if (!this.cfg.enabled) return;
    try {
      switch (e.kind) {
        case "write":
          if (e.path.toLowerCase().endsWith(".md")) await this.indexNote(e.path);
          break;
        case "delete":
          if (e.path.toLowerCase().endsWith(".md")) await this.deleteNote(e.path);
          break;
        case "rename":
          // notify("rename", to, from) — extra holds the old path
          if (e.extra && e.extra.toLowerCase().endsWith(".md")) await this.deleteNote(e.extra);
          if (e.path.toLowerCase().endsWith(".md")) await this.indexNote(e.path);
          break;
        case "folder-delete":
          // The folder's notes are already in trash by the time this
          // fires; `paths` carries their pre-trash relative paths so
          // store rows for the whole subtree get dropped, not just the
          // folder's own path (which was never a row key).
          await Promise.all((e.paths ?? []).map((p) => this.deleteNote(p)));
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

  // Runs `action` for `path`, serialised: a second call while one is
  // in-flight doesn't start a parallel job (which could race the first and
  // leave either a dropped edit or a resurrected delete), it just records
  // that `action` should run again once the in-flight job settles.
  private async run(path: string, action: PendingAction): Promise<void> {
    this.touchedAt.set(path, ++this.seq);
    const existing = this.jobs.get(path);
    if (existing) {
      this.pending.set(path, action);
      return existing;
    }
    const job = this.runOne(path, action).finally(() => {
      this.jobs.delete(path);
      const next = this.pending.get(path);
      if (next !== undefined) {
        this.pending.delete(path);
        void this.run(path, next);
      }
    });
    this.jobs.set(path, job);
    return job;
  }

  private async runOne(path: string, action: PendingAction): Promise<void> {
    await this.store.ensureOpen();
    if (action === "delete") {
      await this.store.deleteByPath(path);
      await this.store.deleteTasksByPath(path);
      return;
    }
    await this.indexOne(path);
  }

  async indexNote(rel: string): Promise<void> {
    return this.run(rel, "write");
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
    return this.run(rel, "delete");
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
    const reindexStartSeq = this.seq;
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
    // V-concurrency #20: a full reindex only ever upserted notes that
    // still exist, rows for notes removed since the last reindex (a
    // single delete, or a whole folder deleted in one go) were never
    // compared against the current vault and lingered forever. Diff the
    // store's paths against what's on disk now and drop the rest.
    //
    // Codex r2 #15: re-list the vault here rather than reusing `notes`
    // (captured before the loop above ran). A note written and indexed
    // concurrently with this reindex would be in the store but not in
    // that stale snapshot, and would get deleted right back out by this
    // very reconciliation.
    //
    // Codex r3 #6: re-listing isn't enough on its own, a note can be
    // written and indexed in the gap between this listing and the
    // distinctPaths() read just below, so it's absent from noteSet but
    // present in the store, and would still look "stale" by that diff
    // alone. touchedAt (bumped by every run() call) catches that: a path
    // queued for write/delete after this reindex started is never
    // reconciled away here, even if it raced the listing.
    const currentNotes = await this.vault.listAllNotes();
    const noteSet = new Set(currentNotes);
    const storedPaths = await this.store.distinctPaths();
    await Promise.all(
      storedPaths
        .filter((p) => !noteSet.has(p) && (this.touchedAt.get(p) ?? 0) <= reindexStartSeq)
        .map((p) => this.run(p, "delete")),
    );
    // Codex r2 #14: only declare the store compatible with the active
    // embedder once every note was actually rewritten under it. A
    // partial rebuild (any skip) means some rows may still be stale or
    // missing; leave `incompatible` as it was rather than waving queries
    // through against an index that isn't fully rebuilt.
    if (skipped === 0) {
      this.store.markRebuilt(describeProvider(this.cfg));
    }
    return { indexed, skipped, durationMs: Date.now() - t0 };
  }
}
