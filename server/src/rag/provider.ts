import { formatId, resolveFormat } from "./format";
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
  embed(texts: string[], opts?: EmbedOptions): Promise<Float32Array[]>;
}

export interface EmbedOptions {
  // Per request. Queries use a short one so a sleeping or unreachable
  // embedder falls back to keyword search quickly.
  timeoutMs?: number;
}

// Factory implemented in pipeline (so this file stays cycle-free).
export function describeProvider(cfg: RagConfig): {
  providerId: ProviderId;
  modelId: string;
  dim: number;
  endpoint?: string;
  format: string;
} {
  const format = formatId(resolveFormat(cfg));
  if (cfg.provider === "local") {
    return {
      providerId: "local",
      modelId: cfg.local.model,
      dim: cfg.local.dim,
      format,
    };
  }
  return {
    providerId: "openai-compat",
    modelId: cfg.openaiCompat.model,
    dim: cfg.openaiCompat.dim,
    // Same model name + dim against a different host is not the same
    // embedder; fold the endpoint into the fingerprint used to decide
    // whether existing rows are still comparable.
    endpoint: cfg.openaiCompat.baseURL,
    format,
  };
}
