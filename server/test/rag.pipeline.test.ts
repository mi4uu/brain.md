import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/vault/vault";
import { RagPipeline } from "../src/rag/pipeline";
import { RagStore } from "../src/rag/store";
import { DEFAULT_RAG_CONFIG } from "../src/rag/types";
import type { Embedder } from "../src/rag/provider";
import type { ProviderId } from "../src/rag/types";

const DIM = 4;

// A controllable stand-in for the real embedders (which need a model
// download / network access) so these tests can control exactly when an
// embed() call resolves — the race conditions under test only show up when
// one embed() is still in flight while another mutation arrives.
class FakeEmbedder implements Embedder {
  readonly providerId: ProviderId = "local";
  modelId: string;
  readonly dim = DIM;
  delayMs = 0;
  calls = 0;

  constructor(modelId = "fake-model") {
    this.modelId = modelId;
  }

  async ready(): Promise<void> {}

  async embed(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    return texts.map((_, i) => {
      const v = new Array(DIM).fill(0);
      v[i % DIM] = 1;
      return Float32Array.from(v);
    });
  }
}

let dir: string;
let vault: Vault;
let store: RagStore;
let pipeline: RagPipeline;
let embedder: FakeEmbedder;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-rag-pipeline-"));
  vault = new Vault(dir);
  await vault.ensureRoot();
  store = new RagStore(join(dir, ".brain", "lance"), DIM);
  const cfg = { ...DEFAULT_RAG_CONFIG, enabled: true, local: { model: "fake-model", dim: DIM } };
  pipeline = new RagPipeline(vault, store, cfg);
  embedder = new FakeEmbedder();
  // Swap in the fake embedder — RagPipeline has no injection seam for this
  // (it always builds a real embedder from cfg), so reach into the
  // private field. Pragmatic for a concurrency test, not a style to copy
  // for ordinary behaviour tests.
  (pipeline as unknown as { embedder: Embedder }).embedder = embedder;
  pipeline.start();
});

afterEach(async () => {
  pipeline.stop();
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe("RagPipeline concurrency (V-concurrency #19)", () => {
  test("an edit that lands mid-embed is not dropped", async () => {
    await vault.writeNote("a.md", "version one");
    embedder.delayMs = 40;
    const firstWrite = vault.writeNote("a.md", "version one (slow embed)");
    // Vault.notify() awaits VaultIndex's listener but RagPipeline's is
    // fire-and-forget, so the write resolves before the embed job does —
    // give the first indexNote() a moment to actually start before firing
    // the second mutation at the same path.
    await new Promise((r) => setTimeout(r, 5));
    await firstWrite;
    embedder.delayMs = 0;
    await vault.writeNote("a.md", "version two");
    // Let the queued rerun (pending action) settle.
    await new Promise((r) => setTimeout(r, 150));
    const hits = await store.search(Float32Array.from([1, 0, 0, 0]), 5);
    const rows = hits.filter((h) => h.path === "a.md");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.snippet).toContain("version two");
  });

  test("a delete that lands mid-embed is not resurrected", async () => {
    embedder.delayMs = 40;
    const writeDone = vault.writeNote("b.md", "will be deleted");
    await new Promise((r) => setTimeout(r, 5));
    await vault.deleteNote("b.md");
    await writeDone;
    // Let the pending delete rerun after the stale write job settles.
    await new Promise((r) => setTimeout(r, 150));
    const hits = await store.search(Float32Array.from([1, 0, 0, 0]), 10);
    expect(hits.find((h) => h.path === "b.md")).toBeUndefined();
  });
});

describe("RagPipeline folder delete (V-concurrency #20)", () => {
  test("deleting a folder removes its notes' rows from the store", async () => {
    await vault.writeNote("sub/a.md", "alpha content");
    await vault.writeNote("sub/b.md", "beta content");
    await new Promise((r) => setTimeout(r, 50));
    expect(await store.countAll()).toBeGreaterThan(0);
    await vault.deleteFolder("sub");
    await new Promise((r) => setTimeout(r, 50));
    const hits = await store.search(Float32Array.from([1, 0, 0, 0]), 10);
    expect(hits.find((h) => h.path.startsWith("sub/"))).toBeUndefined();
  });
});

describe("RagPipeline embedding config mismatch (V-concurrency #23)", () => {
  test("reindexAll removes rows for notes deleted since the last reindex", async () => {
    await vault.writeNote("x.md", "x content");
    await vault.writeNote("y.md", "y content");
    await pipeline.reindexAll();
    expect(await store.countAll()).toBe(2);
    await vault.deleteNote("y.md");
    await new Promise((r) => setTimeout(r, 50));
    // reindexAll should reconcile away any store rows for paths no longer
    // on disk, even ones a live mutation event already should have removed.
    await pipeline.reindexAll();
    const paths = await store.distinctPaths();
    expect(paths).toEqual(["x.md"]);
  });

  test("switching provider/model refuses queries until a reindex", async () => {
    await vault.writeNote("z.md", "z content");
    await new Promise((r) => setTimeout(r, 50));
    expect(await store.countAll()).toBeGreaterThan(0);

    pipeline.applyConfig({
      ...DEFAULT_RAG_CONFIG,
      enabled: true,
      local: { model: "a-different-model", dim: DIM },
    });
    // applyConfig rebuilds a real embedder from cfg; swap the fake back in
    // (same seam as beforeEach) with the new model id so indexOne() still
    // works without network access.
    embedder = new FakeEmbedder("a-different-model");
    (pipeline as unknown as { embedder: Embedder }).embedder = embedder;

    await expect(store.search(Float32Array.from([1, 0, 0, 0]), 5)).rejects.toThrow(
      /different provider\/model/,
    );

    await pipeline.reindexAll();
    // Rebuilt under the new config — queries work again, no NaN scores.
    const hits = await store.search(Float32Array.from([1, 0, 0, 0]), 5);
    for (const h of hits) expect(Number.isNaN(h.score)).toBe(false);
  });
});
