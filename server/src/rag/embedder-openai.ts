import type { Embedder } from "./provider";
import type { OpenAICompatProviderConfig } from "./types";

// Stub — real impl lands in T101. Posts to
// `<baseURL>/embeddings` (or `<baseURL>/v1/embeddings` if baseURL lacks /v1).
export class OpenAICompatEmbedder implements Embedder {
  readonly providerId = "openai-compat" as const;
  readonly modelId: string;
  readonly dim: number;

  constructor(private readonly cfg: OpenAICompatProviderConfig) {
    this.modelId = cfg.model;
    this.dim = cfg.dim;
  }

  async ready(): Promise<void> {
    // no-op: HTTP endpoint, no local warm-up
  }

  async embed(_texts: string[]): Promise<Float32Array[]> {
    throw new Error("OpenAICompatEmbedder.embed not implemented (T101)");
  }
}
