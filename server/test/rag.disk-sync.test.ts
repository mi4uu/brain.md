import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultIndex } from "../src/index/index";
import type { Embedder } from "../src/rag/provider";
import { RagPipeline } from "../src/rag/pipeline";
import { RagStore } from "../src/rag/store";
import type { ProviderId } from "../src/rag/types";
import { DEFAULT_RAG_CONFIG } from "../src/rag/types";
import { syncWithDisk } from "../src/vault/disk-sync";
import { Vault } from "../src/vault/vault";

const DIM = 4;

// Every text gets the same vector, so a search returns every stored row
// and the tests can see exactly which paths the store still holds.
class FlatEmbedder implements Embedder {
  readonly providerId: ProviderId = "local";
  readonly modelId = "fake-model";
  readonly dim = DIM;
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => Float32Array.from([1, 0, 0, 0]));
  }
}

let dir: string;
let vault: Vault;
let store: RagStore;
let pipeline: RagPipeline;
let index: VaultIndex;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-disk-sync-"));
  vault = new Vault(dir);
  await vault.ensureRoot();
  store = new RagStore(join(dir, ".brain", "lance"), DIM);
  await store.open();
  const cfg = { ...DEFAULT_RAG_CONFIG, enabled: true, local: { model: "fake-model", dim: DIM } };
  pipeline = new RagPipeline(vault, store, cfg);
  (pipeline as unknown as { embedder: Embedder }).embedder = new FlatEmbedder();
  index = new VaultIndex(vault);
});

afterEach(async () => {
  pipeline.stop();
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

async function addNote(path: string, body: string): Promise<void> {
  await vault.writeNote(path, body);
  await pipeline.indexNote(path);
  await index.updatePath(path);
}

const stored = async () => [...(await store.pathMtimes()).keys()].sort();
const q = Float32Array.from([1, 0, 0, 0]);

describe("vector store follows the disk", () => {
  test("a note deleted outside brain.md never comes back from search, and its rows go", async () => {
    await addNote("secrets/token.md", "# Token\nold secret text\n- [ ] rotate it\n");
    await addNote("keep.md", "# Keep\nstill here\n");
    await unlink(join(dir, "secrets/token.md"));

    const hits = await pipeline.search(q, 50);
    expect(hits.map((h) => h.path)).toEqual(["keep.md"]);
    const tasks = await pipeline.searchTasks(q, 50, "all");
    expect(tasks.map((t) => t.path)).not.toContain("secrets/token.md");

    // The stale rows were queued for deletion by the search itself.
    await new Promise((r) => setTimeout(r, 20));
    expect(await stored()).toEqual(["keep.md"]);
  });

  test("a sync drops notes moved or deleted on disk and embeds the new location", async () => {
    await addNote("prywatne/a.md", "# A\nalpha\n");
    await addNote("hermes/tasks.md", "# Tasks\n- [ ] one\n");
    await mkdir(join(dir, "private"), { recursive: true });
    await rename(join(dir, "prywatne/a.md"), join(dir, "private/a.md"));
    await unlink(join(dir, "hermes/tasks.md"));

    const r = await pipeline.syncWithDisk();
    expect(r.removed.sort()).toEqual(["hermes/tasks.md", "prywatne/a.md"]);
    expect(r.updated).toEqual(["private/a.md"]);
    expect(await stored()).toEqual(["private/a.md"]);
  });

  test("a sync re-embeds a note edited on disk and leaves unchanged notes alone", async () => {
    await addNote("n.md", "# N\nfirst\n");
    await addNote("same.md", "# Same\n");
    await writeFile(join(dir, "n.md"), "# N\nsecond\n");
    const later = new Date(Date.now() + 5000);
    await utimes(join(dir, "n.md"), later, later);

    const r = await pipeline.syncWithDisk();
    expect(r).toEqual({ removed: [], updated: ["n.md"] });
    const again = await pipeline.syncWithDisk();
    expect(again).toEqual({ removed: [], updated: [] });
  });

  test("startup: rows left from before a restart are reconciled", async () => {
    await addNote("gone.md", "# Gone\n");
    await addNote("here.md", "# Here\n");
    await store.close();
    await unlink(join(dir, "gone.md"));

    const store2 = new RagStore(join(dir, ".brain", "lance"), DIM);
    await store2.open();
    const cfg = { ...DEFAULT_RAG_CONFIG, enabled: true, local: { model: "fake-model", dim: DIM } };
    const p2 = new RagPipeline(vault, store2, cfg);
    (p2 as unknown as { embedder: Embedder }).embedder = new FlatEmbedder();
    const r = await p2.syncWithDisk();
    expect(r.removed).toEqual(["gone.md"]);
    expect([...(await store2.pathMtimes()).keys()]).toEqual(["here.md"]);
    await store2.close();
  });

  test("disk sync also drops the note from the index, so backlinks forget it", async () => {
    await addNote("target.md", "# Target\n");
    await addNote("linker.md", "[[target]]\n");
    expect(index.backlinks("target.md").map((b) => b.from)).toEqual(["linker.md"]);
    await unlink(join(dir, "linker.md"));

    const r = await syncWithDisk(index, pipeline);
    expect(r.index.removed).toBe(1);
    expect(r.rag.removed).toEqual(["linker.md"]);
    expect(index.backlinks("target.md")).toEqual([]);
  });

  test("an empty or frontmatter-only note is not re-synced on every tick", async () => {
    await addNote("empty.md", "");
    await addNote("fm.md", "---\ntags: [x]\n---\n");
    expect(await pipeline.syncWithDisk()).toEqual({ removed: [], updated: [] });
  });

  test("no sync while a full reindex runs", async () => {
    await vault.writeNote("a.md", "# A\n");
    const reindex = pipeline.reindexAll();
    expect(await pipeline.syncWithDisk()).toEqual({ removed: [], updated: [] });
    await reindex;
  });

  test("an embedder failure stops the sync after the first note", async () => {
    for (const p of ["a.md", "b.md", "c.md"]) await writeFile(join(dir, p), `# ${p}\n`);
    let calls = 0;
    (pipeline as unknown as { embedder: Embedder }).embedder = {
      ...new FlatEmbedder(),
      embed: async () => {
        calls++;
        throw new Error("embedder down");
      },
    } as unknown as Embedder;
    const r = await pipeline.syncWithDisk();
    expect(r.updated).toEqual([]);
    expect(calls).toBe(1);
  });

  test("with RAG off the sync touches nothing", async () => {
    await addNote("x.md", "# X\n");
    pipeline.applyConfig({ ...DEFAULT_RAG_CONFIG, enabled: false });
    await unlink(join(dir, "x.md"));
    expect(await pipeline.syncWithDisk()).toEqual({ removed: [], updated: [] });
  });
});
