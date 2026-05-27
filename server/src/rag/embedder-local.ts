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
        const mod = await import("@xenova/transformers");
        // Quiet down progress logs unless debugging.
        if (typeof mod.env === "object" && mod.env) {
          (mod.env as { allowLocalModels?: boolean }).allowLocalModels = false;
        }
        const p = await mod.pipeline("feature-extraction", this.modelId);
        this.pipe = p as unknown as FeatureExtractionPipeline;
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
