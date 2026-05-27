import type { Vault, MutationEvent } from "../vault/vault";
import { chunkNote } from "./chunker";
import { LocalEmbedder } from "./embedder-local";
import { OpenAICompatEmbedder } from "./embedder-openai";
import type { Embedder } from "./provider";
import { describeProvider } from "./provider";
import { RagStore } from "./store";
import type { EmbeddedChunk, RagConfig } from "./types";

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

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  applyConfig(cfg: RagConfig): void {
    const sameProvider = describeProvider(this.cfg).providerId === describeProvider(cfg).providerId;
    const sameModel = describeProvider(this.cfg).modelId === describeProvider(cfg).modelId;
    this.cfg = cfg;
    if (!sameProvider || !sameModel) {
      this.embedder = makeEmbedder(cfg);
    }
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
    const job = this.indexOne(rel).finally(() => this.indexing.delete(rel));
    this.indexing.set(rel, job);
    return job;
  }

  private async indexOne(rel: string): Promise<void> {
    const note = await this.vault.readNote(rel);
    const chunks = chunkNote(rel, note.content);
    // Always wipe prior rows for this path so removed paragraphs don't linger.
    await this.store.deleteByPath(rel);
    if (chunks.length === 0) {
      this.lastIndexedAt = Date.now();
      return;
    }
    const vectors = await this.embedder.embed(chunks.map((c) => c.text));
    const desc = describeProvider(this.cfg);
    const rows: EmbeddedChunk[] = chunks.map((c, i) => ({
      ...c,
      id: `${rel}#${c.chunkIndex}`,
      embedding: vectors[i]!,
      mtime: note.mtime,
      modelId: desc.modelId,
      providerId: desc.providerId,
    }));
    await this.store.upsert(rows);
    this.lastIndexedAt = Date.now();
  }

  async deleteNote(rel: string): Promise<void> {
    await this.store.deleteByPath(rel);
  }

  // Public encode hook for ad-hoc queries (used by /api/similar).
  async embed(texts: string[]): Promise<Float32Array[]> {
    return this.embedder.embed(texts);
  }

  async reindexAll(): Promise<{ indexed: number; skipped: number; durationMs: number }> {
    const t0 = Date.now();
    const notes = await this.vault.listAllNotes();
    let indexed = 0;
    let skipped = 0;
    for (const rel of notes) {
      try {
        await this.indexNote(rel);
        indexed++;
      } catch {
        skipped++;
      }
    }
    return { indexed, skipped, durationMs: Date.now() - t0 };
  }
}
