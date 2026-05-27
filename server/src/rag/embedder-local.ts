import type { Embedder } from "./provider";
import type { LocalProviderConfig } from "./types";

// Stub — real impl lands in T100. Loads @xenova/transformers lazily on
// first .embed() call to avoid the ~133MB model download at import time.
export class LocalEmbedder implements Embedder {
  readonly providerId = "local" as const;
  readonly modelId: string;
  readonly dim: number;

  constructor(private readonly cfg: LocalProviderConfig) {
    this.modelId = cfg.model;
    this.dim = cfg.dim;
  }

  async ready(): Promise<void> {
    throw new Error("LocalEmbedder.ready not implemented (T100)");
  }

  async embed(_texts: string[]): Promise<Float32Array[]> {
    throw new Error("LocalEmbedder.embed not implemented (T100)");
  }
}
