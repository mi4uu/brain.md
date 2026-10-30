import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RagStore } from "../src/rag/store";
import { RagPipeline } from "../src/rag/pipeline";
import { Vault } from "../src/vault/vault";
import { DEFAULT_RAG_CONFIG } from "../src/rag/types";
import type { Embedder } from "../src/rag/provider";
import type { ProviderId } from "../src/rag/types";

let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-rag-dim-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Regression for Codex r2 #13: RagStore.open() wiped vectors.json whenever
// its dim didn't match the constructor's dim, but the constructor's dim is
// only the default provider's dim at app startup, before settings.load()
// has applied the vault's actual (possibly non-default) configuration.
describe("RagStore persists and restores the real embedding dim", () => {
  test("open() trusts the file's dim instead of wiping on a constructor-dim mismatch", async () => {
    const storeDir = join(dir, "lance");
    // Simulate a vault whose embedder uses dim 1536, written by a
    // previous run.
    const store1 = new RagStore(storeDir, 1536);
    await store1.open();
    await store1.upsert([
      {
        id: "a.md#0",
        path: "a.md",
        chunkIndex: 0,
        text: "hello",
        headingTrail: [],
        lineStart: 1,
        lineEnd: 1,
        mtime: 1,
        modelId: "big-model",
        providerId: "openai-compat",
        embedding: new Float32Array(1536).fill(0.1),
      },
    ]);
    store1.setExpectedConfig({ providerId: "openai-compat", modelId: "big-model", dim: 1536 });
    await store1.close();

    // A fresh app start constructs the store with the *default* dim
    // (384) before settings.load() has run, same as app.ts does.
    const store2 = new RagStore(storeDir, 384);
    await store2.open();
    expect(await store2.countAll()).toBe(1); // not wiped
    expect(store2.dim).toBe(1536); // corrected from the file
  });
});

class FakeEmbedder implements Embedder {
  readonly providerId: ProviderId = "local";
  readonly modelId = "fake-model";
  readonly dim = 4;
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      if (t.includes("FAIL")) throw new Error("embed failed");
      return new Float32Array(this.dim).fill(1);
    });
  }
}

describe("RagPipeline.reindexAll", () => {
  let vault: Vault;
  let store: RagStore;
  let pipeline: RagPipeline;

  beforeEach(async () => {
    vault = new Vault(dir);
    await vault.ensureRoot();
    store = new RagStore(join(dir, ".brain", "lance"), 4);
    const cfg = { ...DEFAULT_RAG_CONFIG, enabled: true, local: { model: "fake-model", dim: 4 } };
    pipeline = new RagPipeline(vault, store, cfg);
    (pipeline as unknown as { embedder: Embedder }).embedder = new FakeEmbedder();
  });
  afterEach(async () => {
    await store.close();
  });

  // Codex r2 #14: a reindex that skips any note must not clear the
  // store's incompatible flag, otherwise queries resume against an
  // index that was never actually fully rebuilt.
  test("a partial reindex (some notes skipped) does not mark the store compatible", async () => {
    store.setExpectedConfig({ providerId: "local", modelId: "old-model", dim: 4 });
    store.setExpectedConfig({ providerId: "local", modelId: "fake-model", dim: 4 }); // flips incompatible
    expect(() => store.checkQueryable()).toThrow();

    await vault.writeNote("ok.md", "fine content");
    await vault.writeNote("bad.md", "FAIL this one");
    const result = await pipeline.reindexAll();
    expect(result.skipped).toBe(1);
    expect(() => store.checkQueryable()).toThrow();
  });

  test("a fully successful reindex marks the store compatible again", async () => {
    store.setExpectedConfig({ providerId: "local", modelId: "old-model", dim: 4 });
    store.setExpectedConfig({ providerId: "local", modelId: "fake-model", dim: 4 });
    expect(() => store.checkQueryable()).toThrow();

    await vault.writeNote("ok.md", "fine content");
    const result = await pipeline.reindexAll();
    expect(result.skipped).toBe(0);
    expect(() => store.checkQueryable()).not.toThrow();
  });

  // Codex r2 #15: reconciliation must diff against vault membership taken
  // after indexing finishes, not the snapshot from before the loop ran,
  // or a note written concurrently with the reindex gets deleted right
  // back out.
  test("a note written during reindexAll is not deleted by reconciliation", async () => {
    await vault.writeNote("first.md", "first content");
    let injected = false;
    const realList = vault.listAllNotes.bind(vault);
    vault.listAllNotes = async () => {
      const notes = await realList();
      // The *first* call is reindexAll's initial snapshot; simulate a
      // concurrent write landing right after it's taken, before the
      // reconciliation re-lists at the end.
      if (!injected) {
        injected = true;
        await vault.writeNote("concurrent.md", "snuck in mid-reindex");
        await pipeline.indexNote("concurrent.md");
      }
      return notes;
    };

    await pipeline.reindexAll();
    const stored = await store.distinctPaths();
    expect(stored).toContain("concurrent.md");
  });
});
