import type { RagConfig, ProviderId } from "./types";

// V49: provider abstraction. Concrete implementations in
// embedder-local.ts (Xenova / ONNX) and embedder-openai.ts
// (OpenAI-compatible /v1/embeddings).
export interface Embedder {
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly dim: number;

  // Lazy init for providers that need to download model weights etc.
  ready(): Promise<void>;

  // Batch encode — many providers accept arrays directly for throughput.
  embed(texts: string[]): Promise<Float32Array[]>;
}

// Factory implemented in pipeline (so this file stays cycle-free).
export function describeProvider(cfg: RagConfig): {
  providerId: ProviderId;
  modelId: string;
  dim: number;
} {
  if (cfg.provider === "local") {
    return {
      providerId: "local",
      modelId: cfg.local.model,
      dim: cfg.local.dim,
    };
  }
  return {
    providerId: "openai-compat",
    modelId: cfg.openaiCompat.model,
    dim: cfg.openaiCompat.dim,
  };
}
