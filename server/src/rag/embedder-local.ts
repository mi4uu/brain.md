import type { Embedder } from "./provider";
import type { LocalProviderConfig } from "./types";

// V49: local embedder via @xenova/transformers (ONNX). Model is lazy-loaded
// on first .embed() / .ready() call so server startup + most tests don't pay
// the ~133MB download cost. Pipeline reference cached on the instance.

type FeatureExtractionPipeline = (
  text: string | string[],
  opts?: { pooling?: "mean" | "cls" | "none"; normalize?: boolean },
) => Promise<{ data: Float32Array | number[]; dims?: number[] }>;

export class LocalEmbedder implements Embedder {
  readonly providerId = "local" as const;
  readonly modelId: string;
  readonly dim: number;

  private pipe?: FeatureExtractionPipeline;
  private readyPromise?: Promise<void>;

  constructor(private readonly cfg: LocalProviderConfig) {
    this.modelId = cfg.model;
    this.dim = cfg.dim;
  }

  async ready(): Promise<void> {
    if (this.pipe) return;
    if (!this.readyPromise) {
      this.readyPromise = (async () => {
        try {
          const mod = await import("@xenova/transformers");
          // Quiet down progress logs unless debugging.
          if (typeof mod.env === "object" && mod.env) {
            (mod.env as { allowLocalModels?: boolean }).allowLocalModels = false;
          }
          const p = await mod.pipeline("feature-extraction", this.modelId);
          this.pipe = p as unknown as FeatureExtractionPipeline;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // B14: Xenova/transformers pulls in onnxruntime-node which loads a
          // platform-specific .so/.dll/.dylib at runtime. `bun --compile`
          // doesn't bundle those, so users running the prebuilt brainmd
          // binary hit `libonnxruntime.so.X: cannot open shared object file`.
          // Translate to an actionable hint that points at the openai-compat
          // escape hatch (Ollama / LM Studio).
          // Match every native-binding failure shape Xenova/transformers can
          // throw on a prebuilt binary: onnxruntime (.so/.dll/.dylib), sharp
          // (image preprocessing — pulled in even for text embedders), and
          // anything ending in `.node` (generic node native).
          if (/onnxruntime|libonnx|sharp|\.node['"\s]|\.so\.\d|\.dylib|\.dll/i.test(msg)) {
            throw new Error(
              "Local embedder needs native libraries (onnxruntime, sharp) " +
                "that the prebuilt binary can't bundle. Switch the RAG " +
                "provider to 'OpenAI-compatible' and point it at Ollama " +
                "(recommended) — `ollama pull nomic-embed-text`, baseURL " +
                "http://localhost:11434/v1, dim 768. Original error: " + msg,
            );
          }
          throw err;
        }
      })();
    }
    await this.readyPromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.ready();
    if (!this.pipe) throw new Error("LocalEmbedder pipeline failed to load");

    const out: Float32Array[] = [];
    // bge-small + mean pool + L2 normalize → cosine-similarity-ready
    for (const text of texts) {
      const result = await this.pipe(text, { pooling: "mean", normalize: true });
      const arr =
        result.data instanceof Float32Array
          ? new Float32Array(result.data)
          : Float32Array.from(result.data as number[]);
      if (arr.length !== this.dim) {
        throw new Error(
          `embedding dim mismatch: got ${arr.length}, expected ${this.dim} (model=${this.modelId})`,
        );
      }
      out.push(arr);
    }
    return out;
  }
}
