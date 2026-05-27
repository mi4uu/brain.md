import { describe, test, expect } from "bun:test";
import { LocalEmbedder } from "../src/rag/embedder-local";

describe("LocalEmbedder — V49", () => {
  test("constructor sets providerId / modelId / dim from config", () => {
    const e = new LocalEmbedder({
      model: "Xenova/bge-small-en-v1.5",
      dim: 384,
    });
    expect(e.providerId).toBe("local");
    expect(e.modelId).toBe("Xenova/bge-small-en-v1.5");
    expect(e.dim).toBe(384);
  });

  test("empty input returns empty array without loading the model", async () => {
    const e = new LocalEmbedder({ model: "Xenova/bge-small-en-v1.5", dim: 384 });
    const r = await e.embed([]);
    expect(r).toEqual([]);
  });

  // Real model download + embed gated by env (CI default skips).
  test.skipIf(!process.env.RUN_REAL_EMBEDDER)(
    "embeds a real string to a 384-dim vector with cosine similarity ~1 against itself",
    async () => {
      const e = new LocalEmbedder({
        model: "Xenova/bge-small-en-v1.5",
        dim: 384,
      });
      const [a, b] = await e.embed(["hello world", "hello world"]);
      expect(a!.length).toBe(384);
      const dot = a!.reduce((s, x, i) => s + x * b![i]!, 0);
      expect(dot).toBeGreaterThan(0.99);
    },
    120_000,
  );
});
