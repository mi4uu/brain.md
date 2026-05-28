// V47 + V48: shared types for the RAG pipeline.

export interface Chunk {
  path: string;
  chunkIndex: number;
  text: string;
  headingTrail: string[]; // e.g. ["Daily", "2024-05-26", "Morning"]
  lineStart: number; // 1-based, inclusive
  lineEnd: number; // 1-based, inclusive
}

export interface EmbeddedChunk extends Chunk {
  id: string; // `${path}#${chunkIndex}`
  embedding: Float32Array;
  mtime: number;
  modelId: string;
  providerId: ProviderId;
}

export type ProviderId = "local" | "openai-compat";

export interface LocalProviderConfig {
  model: string; // e.g. "Xenova/bge-small-en-v1.5"
  dim: number; // 384
}

export interface OpenAICompatProviderConfig {
  baseURL: string; // e.g. "http://localhost:11434" or "https://api.openai.com"
  model: string; // e.g. "text-embedding-3-small" or "nomic-embed-text"
  apiKey?: string;
  dim: number;
}

export interface RagConfig {
  enabled: boolean;
  provider: ProviderId;
  local: LocalProviderConfig;
  openaiCompat: OpenAICompatProviderConfig;
}

export const DEFAULT_RAG_CONFIG: RagConfig = {
  enabled: false,
  provider: "local",
  local: { model: "Xenova/bge-small-en-v1.5", dim: 384 },
  openaiCompat: {
    baseURL: "http://localhost:11434/v1",
    model: "nomic-embed-text",
    dim: 768,
  },
};

export interface SearchHit {
  path: string;
  chunkIndex: number;
  score: number; // cosine similarity ∈ [0, 1]
  snippet: string;
  headingTrail: string[];
  lineStart: number;
  lineEnd: number;
}

export interface RagStatus {
  enabled: boolean;
  provider: ProviderId;
  model: string;
  dim: number;
  chunks: number;
  lastIndexedAt: number | null;
  needsReindex: boolean;
  // V59: most recent embedder failure, if any. Null when probe last succeeded
  // OR when no probe has ever run. UI surfaces this in a persistent banner.
  lastError: string | null;
}

// V49: chunker constants
export const CHUNK_TARGET_TOKENS = 512;
export const CHUNK_OVERLAP_TOKENS = 64;

// V55: per-task indexed unit (parallel to Chunk for note body).
export interface TaskChunk {
  path: string;
  lineNo: number; // 1-based, same coordinate system as Chunk.lineStart
  text: string;
  done: boolean;
}

export interface EmbeddedTaskChunk extends TaskChunk {
  id: string; // `${path}#L${lineNo}`
  embedding: Float32Array;
  mtime: number;
  modelId: string;
  providerId: ProviderId;
}

export interface TaskHit {
  path: string;
  lineNo: number;
  text: string;
  done: boolean;
  score: number;
}
