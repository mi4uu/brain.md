import type { Vault, MutationEvent } from "../vault/vault";
import { chunkNote, chunkTasks } from "./chunker";
import { LocalEmbedderWasm as LocalEmbedder } from "./embedder-local-wasm";
import { OpenAICompatEmbedder, isEmbedderUnavailable } from "./embedder-openai";
import { formatDocument, formatQuery, resolveFormat } from "./format";
import { globMatcher } from "../vault/glob";
import type { Embedder } from "./provider";
import { describeProvider } from "./provider";
import type { RagStore } from "./store";
import type { EmbeddedChunk, EmbeddedTaskChunk, RagConfig, SearchHit, TaskHit } from "./types";

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

const QUERY_TIMEOUT_MS = 4000;
// Per batch of 8 chunks for note-to-note tools (outline, digest, compare):
// a CPU-only embedder needs seconds per batch.
const DOCUMENT_QUERY_TIMEOUT_MS = 60_000;

export class EmbedExcludedError extends Error {
  constructor(public readonly path: string) {
    super(`${path} is excluded from embedding (Settings, AI / RAG, "Never send to the embedder")`);
    this.name = "EmbedExcludedError";
  }
}

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
  // listing it diffs against was taken but before it diffed"; the latter
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

  // Last mtime each note was embedded at, rows or not (see syncWithDisk).
  private readonly syncedMtime = new Map<string, number>();
  private reindexing = 0;

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
    // Embedded under the old config; a resumed reindex must redo them.
    this.syncedMtime.clear();
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
      this.syncedMtime.delete(path);
      return;
    }
    await this.indexOne(path);
  }

  async indexNote(rel: string): Promise<void> {
    return this.run(rel, "write");
  }

  private async indexOne(rel: string): Promise<void> {
    if (this.isExcluded(rel)) {
      // Never sent to the embedder; rows from before the exclusion go.
      await this.store.deleteByPath(rel);
      await this.store.deleteTasksByPath(rel);
      return;
    }
    const note = await this.vault.readNote(rel);
    const chunks = chunkNote(rel, note.content);
    const tasks = chunkTasks(rel, note.content);
    const desc = describeProvider(this.cfg);
    const fmt = resolveFormat(this.cfg);

    // Embed body chunks + task texts together so we pay the embedder
    // warm-up cost once per note. Embed first: if the embedder is down the
    // note keeps its old rows instead of dropping out of search.
    const docs = [...chunks.map((c) => c.text), ...tasks.map((t) => t.text)].map((t) =>
      formatDocument(fmt, rel, t),
    );
    const allVectors = docs.length === 0 ? [] : await this.embedder.embed(docs);

    // Wipe prior rows for this path so removed content doesn't linger.
    await this.store.deleteByPath(rel);
    await this.store.deleteTasksByPath(rel);

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

    this.syncedMtime.set(rel, note.mtime);
    this.lastIndexedAt = Date.now();
  }

  async deleteNote(rel: string): Promise<void> {
    return this.run(rel, "delete");
  }

  // Brings the store in line with the vault on disk: drops rows for notes
  // that are gone (deleted or moved outside brain.md: mv, git pull, another
  // tool, or while RAG was off) and re-embeds notes that are new or changed
  // since they were indexed. Mutation events only cover changes made
  // through brain.md, so this runs at startup and on a timer.
  async syncWithDisk(): Promise<{ removed: string[]; updated: string[] }> {
    // A full reindex covers everything; syncing alongside it would embed the
    // notes it has not reached yet a second time.
    if (!this.cfg.enabled || this.reindexing > 0) return { removed: [], updated: [] };
    await this.store.ensureOpen();
    if (this.store.isIncompatible()) {
      // Rows from another model or format are useless; finish (or resume)
      // the full reindex instead of patching single notes.
      await this.reindexAll({ resume: true });
      return { removed: [], updated: [] };
    }
    const startSeq = this.seq;
    const notes = await this.vault.listAllNotes();
    const onDisk = new Set(notes);
    const stored = await this.store.pathMtimes();
    // A path queued since this sync started is newer than what we saw.
    const untouched = (p: string) => (this.touchedAt.get(p) ?? 0) <= startSeq;
    const removed = [...stored.keys()].filter((p) => (!onDisk.has(p) || this.isExcluded(p)) && untouched(p));
    const updated: string[] = [];
    for (const p of notes) {
      if (this.isExcluded(p)) continue;
      const s = await this.vault.stat(p);
      if (!s.exists) continue;
      // Notes with no chunks and no tasks (empty, frontmatter only) leave no
      // rows, so the mtime of the last successful pass counts too.
      const seen = Math.max(stored.get(p) ?? -1, this.syncedMtime.get(p) ?? -1);
      if ((seen < 0 || s.mtime > seen) && untouched(p)) updated.push(p);
    }
    await Promise.all(removed.map((p) => this.run(p, "delete")));
    const done: string[] = [];
    for (const p of updated) {
      try {
        await this.run(p, "write");
        done.push(p);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isEmbedderUnavailable(e)) {
          // The rest would fail the same way; the next tick retries.
          console.warn(`[rag] sync stopped at ${p} (${updated.length - done.length} notes left): ${msg}`);
          break;
        }
        // One bad note (too long, unreadable) must not block the others.
        console.warn(`[rag] sync skipped ${p}: ${msg}`);
      }
    }
    return { removed, updated: done };
  }

  // Search results whose note no longer exists on disk are dropped, and the
  // stale rows are queued for deletion, so a deleted note (secrets included)
  // can never come back through semantic search even before the next sync.
  async dropMissing<T extends { path: string }>(rows: T[]): Promise<T[]> {
    const paths = [...new Set(rows.map((r) => r.path))];
    const exists = new Map<string, boolean>();
    await Promise.all(
      paths.map(async (p) => {
        exists.set(p, (await this.vault.stat(p)).exists);
      }),
    );
    for (const p of paths) {
      if (exists.get(p) && this.isExcluded(p)) exists.set(p, false);
      if (!exists.get(p)) this.run(p, "delete").catch(() => {});
    }
    return rows.filter((r) => exists.get(r.path));
  }

  async search(vector: Float32Array, k: number): Promise<SearchHit[]> {
    return this.dropMissing(await this.store.search(vector, k));
  }

  async searchTasks(...args: Parameters<RagStore["searchTasks"]>): Promise<TaskHit[]> {
    return this.dropMissing(await this.store.searchTasks(...args));
  }

  // Search strings: query template, short timeout so an unreachable
  // embedder falls back to keyword search fast.
  async embedQuery(texts: string[]): Promise<Float32Array[]> {
    const f = resolveFormat(this.cfg);
    try {
      return await this.embedder.embed(
        texts.map((t) => formatQuery(f, t)),
        { timeoutMs: QUERY_TIMEOUT_MS },
      );
    } catch (e) {
      this.noteUnavailable(e);
      throw e;
    }
  }

  // Searches fall back to keywords quietly; still record why (Settings
  // banner) and log it now and then, so a wrong key or a dead box is seen.
  private lastUnavailableLog = 0;
  private noteUnavailable(e: unknown): void {
    if (!isEmbedderUnavailable(e)) return;
    const msg = e instanceof Error ? e.message : String(e);
    this.lastProbeError = msg;
    if (Date.now() - this.lastUnavailableLog > 60_000) {
      this.lastUnavailableLog = Date.now();
      console.warn(`[rag] embedder unavailable, answering with keyword search: ${msg}`);
    }
  }

  // Note text compared with stored chunks (Related, outline, compare,
  // digest, orphans): same document template the chunks were stored with.
  async embedDocuments(items: Array<{ path: string; text: string }>): Promise<Float32Array[]> {
    // Last line of defence for rag.exclude: callers filter first, but no
    // excluded note's text may reach the embedder through any path.
    const excluded = items.find((i) => this.isExcluded(i.path));
    if (excluded) throw new EmbedExcludedError(excluded.path);
    const f = resolveFormat(this.cfg);
    try {
      return await this.embedder.embed(
        items.map((i) => formatDocument(f, i.path, i.text)),
        { timeoutMs: DOCUMENT_QUERY_TIMEOUT_MS },
      );
    } catch (e) {
      this.noteUnavailable(e);
      throw e;
    }
  }

  isExcluded(path: string): boolean {
    return globMatcher(this.cfg.exclude ?? [])(path);
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

  // `resume`: skip notes this process already embedded under the current
  // config and mtime, so a reindex cut short by an unreachable embedder
  // picks up where it stopped instead of starting over.
  async reindexAll(opts: { resume?: boolean } = {}): Promise<{ indexed: number; skipped: number; durationMs: number }> {
    this.reindexing++;
    try {
      return await this.reindexAllInner(opts.resume ?? false);
    } finally {
      this.reindexing--;
    }
  }

  private async reindexAllInner(resume: boolean): Promise<{ indexed: number; skipped: number; durationMs: number }> {
    const t0 = Date.now();
    await this.ensureRunning();
    const reindexStartSeq = this.seq;
    const notes = await this.vault.listAllNotes();
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (let n = 0; n < notes.length; n++) {
      const rel = notes[n]!;
      try {
        if (resume) {
          const done = this.syncedMtime.get(rel);
          if (done !== undefined && done === (await this.vault.stat(rel)).mtime) {
            indexed++;
            continue;
          }
        }
        await this.indexNote(rel);
        indexed++;
      } catch (e) {
        if (isEmbedderUnavailable(e)) {
          // Every remaining note would fail the same way (and a hung
          // embedder costs a timeout each). Stop; the disk sync resumes.
          skipped += notes.length - n;
          const msg = e instanceof Error ? e.message : String(e);
          this.lastProbeError = msg;
          console.warn(`[rag] reindex stopped, embedder unavailable (${notes.length - n} notes left): ${msg}`);
          break;
        }
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
