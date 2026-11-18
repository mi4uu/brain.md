import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VaultIndex } from "../src/index/index";
import { EmbedderHttpError, OpenAICompatEmbedder } from "../src/rag/embedder-openai";
import { defaultFormat, formatDocument, formatQuery, resolveFormat } from "../src/rag/format";
import { EmbedExcludedError, RagPipeline } from "../src/rag/pipeline";
import type { Embedder } from "../src/rag/provider";
import { contextForQuery, keywordHits, related, semanticOutline, weeklyDigest, type RagDeps } from "../src/rag/queries";
import { RagStore } from "../src/rag/store";
import { DEFAULT_RAG_CONFIG, type ProviderId, type RagConfig } from "../src/rag/types";
import { globMatcher } from "../src/vault/glob";
import { Vault } from "../src/vault/vault";

const DIM = 4;

class RecordingEmbedder implements Embedder {
  readonly providerId: ProviderId = "openai-compat";
  readonly modelId = "embeddinggemma-300m";
  readonly dim = DIM;
  seen: string[] = [];
  fail: EmbedderHttpError | null = null;
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (this.fail) throw this.fail;
    this.seen.push(...texts);
    return texts.map(() => Float32Array.from([1, 0, 0, 0]));
  }
}

describe("prompt formats", () => {
  test("EmbeddingGemma gets its retrieval prompts, documents carry the note title", () => {
    const f = defaultFormat("ggml-org/embeddinggemma-300M-GGUF");
    expect(formatQuery(f, "kto to Kamil")).toBe("task: search result | query: kto to Kamil");
    expect(formatDocument(f, "ludzie/kamil.md", "brat")).toBe("title: none | text: kamil\nbrat");
  });

  test("note text with $ patterns is embedded verbatim", () => {
    const f = defaultFormat("embeddinggemma");
    expect(formatQuery(f, "cost $& and $$5 $'")).toBe("task: search result | query: cost $& and $$5 $'");
    expect(formatDocument(f, "a/$1.md", "x $` y")).toBe("title: none | text: $1\nx $` y");
  });

  test("unknown models get the title only; settings override the defaults", () => {
    const f = defaultFormat("some-new-model");
    expect(formatQuery(f, "q")).toBe("q");
    expect(formatDocument(f, "a/b.md", "x")).toBe("b\nx");
    const cfg: RagConfig = { ...DEFAULT_RAG_CONFIG, queryTemplate: "Q: {text}", documentTemplate: "" };
    expect(resolveFormat(cfg).query).toBe("Q: {text}");
    expect(resolveFormat(cfg).document).toBe("{title}\n{text}");
    expect(resolveFormat({ ...cfg, documentTemplate: "T: {title}\\n{text}" }).document).toBe("T: {title}\n{text}");
  });
});

describe("exclude globs", () => {
  test("**/secrets/** matches a secrets segment at any depth, nothing else", () => {
    const m = globMatcher(["**/secrets/**"]);
    expect(m("secrets/token.md")).toBe(true);
    expect(m("zarchiwizowane/hermes/secrets/key.md")).toBe(true);
    expect(m("Secrets/x.md")).toBe(true);
    expect(m("mysecrets/x.md")).toBe(false);
    expect(m("notes/secrets.md")).toBe(false);
  });

  test("single-segment wildcards stay inside a folder", () => {
    const m = globMatcher(["Journal/*.md", "_*"]);
    expect(m("Journal/telefon.md")).toBe(true);
    expect(m("Journal/2026/x.md")).toBe(false);
    expect(m("_template.md")).toBe(true);
  });
});

describe("OpenAI-compatible embedder against a fake server", () => {
  let server: ReturnType<typeof Bun.serve>;
  const requests: Array<{ auth: string | null; inputs: string[] }> = [];
  let hang = false;
  let html = false;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = (await req.json()) as { input: string[] };
        requests.push({ auth: req.headers.get("authorization"), inputs: body.input });
        if (hang) await new Promise((r) => setTimeout(r, 2000));
        if (html) return new Response("<html>proxy error</html>", { headers: { "content-type": "text/html" } });
        // Reversed on purpose: the client must order by `index`.
        const data = body.input.map((_, i) => ({ index: i, embedding: [i, 0, 0, 1] })).reverse();
        return Response.json({ data });
      },
    });
  });
  afterAll(() => server.stop(true));
  beforeEach(() => {
    requests.length = 0;
    hang = false;
    html = false;
  });
  afterEach(() => {
    delete process.env.BRAINMD_EMBED_API_KEY;
  });

  const make = (apiKey?: string) =>
    new OpenAICompatEmbedder({ baseURL: `http://127.0.0.1:${server.port}`, model: "m", dim: DIM, apiKey });

  test("sends batches of 8 and keeps the input order", async () => {
    const out = await make().embed(Array.from({ length: 19 }, (_, i) => `t${i}`));
    expect(requests.map((r) => r.inputs.length)).toEqual([8, 8, 3]);
    expect(out.map((v) => v[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2]);
  });

  test("the env key wins over the saved one", async () => {
    process.env.BRAINMD_EMBED_API_KEY = "from-env";
    await make("from-settings").embed(["x"]);
    expect(requests[0]!.auth).toBe("Bearer from-env");
  });

  test("a 200 that isn't JSON counts as an unreachable embedder", async () => {
    html = true;
    const err = await make()
      .embed(["x"])
      .catch((e) => e);
    expect(err).toBeInstanceOf(EmbedderHttpError);
    expect((err as EmbedderHttpError).status).toBe(0);
  });

  test("a hung server times out as an unreachable embedder", async () => {
    hang = true;
    const err = await make()
      .embed(["x"], { timeoutMs: 100 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(EmbedderHttpError);
    expect((err as EmbedderHttpError).status).toBe(0);
  });
});

describe("pipeline with a remote embedder", () => {
  let dir: string;
  let vault: Vault;
  let store: RagStore;
  let pipeline: RagPipeline;
  let emb: RecordingEmbedder;
  const cfg: RagConfig = {
    ...DEFAULT_RAG_CONFIG,
    enabled: true,
    provider: "openai-compat",
    openaiCompat: { baseURL: "http://dellver:8091/v1", model: "embeddinggemma-300m", dim: DIM },
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "brain-remote-embed-"));
    vault = new Vault(dir);
    await vault.ensureRoot();
    store = new RagStore(join(dir, ".brain", "lance"), DIM);
    await store.open();
    pipeline = new RagPipeline(vault, store, cfg);
    emb = new RecordingEmbedder();
    (pipeline as unknown as { embedder: Embedder }).embedder = emb;
  });
  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("notes under secrets/ are never sent to the embedder, and old rows go", async () => {
    await vault.writeNote("hermes/secrets/key.md", "# Key\nsk-123\n");
    await vault.writeNote("ludzie/kamil.md", "# Kamil\nbrat\n");
    await pipeline.reindexAll();
    expect(emb.seen.some((t) => t.includes("sk-123"))).toBe(false);
    expect([...(await store.pathMtimes()).keys()]).toEqual(["ludzie/kamil.md"]);
    expect(emb.seen[0]).toBe("title: none | text: kamil\n# Kamil\nbrat");
  });

  test("changing the prompt template invalidates the store until a reindex", async () => {
    await vault.writeNote("a.md", "# A\n");
    await pipeline.reindexAll();
    expect(store.isIncompatible()).toBe(false);
    pipeline.applyConfig({ ...cfg, queryTemplate: "Q: {text}" });
    expect(store.isIncompatible()).toBe(true);
    (pipeline as unknown as { embedder: Embedder }).embedder = emb;
    await pipeline.reindexAll();
    expect(store.isIncompatible()).toBe(false);
  });

  test("an outage stops the reindex; the next sync resumes without redoing finished notes", async () => {
    for (const p of ["a.md", "b.md", "c.md"]) await vault.writeNote(p, `# ${p}\n`);
    pipeline.applyConfig({ ...cfg, documentTemplate: "D: {text}" });
    (pipeline as unknown as { embedder: Embedder }).embedder = emb;
    let n = 0;
    const real = emb.embed.bind(emb);
    emb.embed = async (texts) => {
      if (++n === 2) throw new EmbedderHttpError("network error", 0);
      return real(texts);
    };
    const first = await pipeline.reindexAll();
    expect(first.skipped).toBe(2);
    expect(store.isIncompatible()).toBe(true);

    emb.seen = [];
    await pipeline.syncWithDisk();
    expect(store.isIncompatible()).toBe(false);
    expect(emb.seen).toHaveLength(2);
  });

  test("excluded notes never reach the embedder through Related, outline or digest", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} sk-999 ${"word ".repeat(40)}`).join("\n\n");
    await vault.writeNote("secrets/token.md", `# Token\n${long}\n`);
    await vault.writeNote("open.md", "# Open\nhello\n");
    const index = new VaultIndex(vault);
    await index.buildAll();
    await pipeline.reindexAll();
    emb.seen = [];
    const deps: RagDeps = { vault, index, pipeline, ragEnabled: () => true };
    expect(await related(deps, "secrets/token.md")).toEqual([]);
    await expect(semanticOutline(deps, "secrets/token.md")).rejects.toBeInstanceOf(EmbedExcludedError);
    await weeklyDigest(deps, "30d");
    expect(emb.seen.some((t) => t.includes("sk-999"))).toBe(false);
  });

  test("context_for_query answers with keywords when the embedder is down", async () => {
    await writeFile(join(dir, "kamil.md"), "# Kamil\nbrat Michała, mieszka w Krakowie\n");
    const index = new VaultIndex(vault);
    await index.buildAll();
    emb.fail = new EmbedderHttpError("network error", 0);
    const deps: RagDeps = { vault, index, pipeline, ragEnabled: () => true };
    const r = await contextForQuery(deps, "Krakowie");
    expect(r.mode).toBe("keyword");
    expect(r.sources.map((s) => s.path)).toEqual(["kamil.md"]);
    expect(keywordHits(index, "Krakowie", 5, [])[0]!.source).toBe("keyword");
  });
});
