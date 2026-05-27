import type { Embedder } from "./provider";
import type { OpenAICompatProviderConfig } from "./types";

// V49: any OpenAI-compatible /v1/embeddings endpoint. Works against
// Ollama (http://localhost:11434/v1), LM Studio (http://localhost:1234/v1),
// OpenAI itself (https://api.openai.com/v1), or anything else that mirrors
// the request/response shape.

export class EmbedderHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = "EmbedderHttpError";
  }
}

interface OpenAIEmbeddingsResponse {
  data: Array<{ embedding: number[] | Float32Array; index?: number }>;
  model?: string;
}

export function normalizeBaseURL(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/\/v\d+$/.test(u)) u = `${u}/v1`;
  return u;
}

export class OpenAICompatEmbedder implements Embedder {
  readonly providerId = "openai-compat" as const;
  readonly modelId: string;
  readonly dim: number;

  private readonly baseURL: string;
  private readonly apiKey?: string;

  constructor(private readonly cfg: OpenAICompatProviderConfig) {
    this.modelId = cfg.model;
    this.dim = cfg.dim;
    this.baseURL = normalizeBaseURL(cfg.baseURL);
    this.apiKey = cfg.apiKey?.trim() || undefined;
  }

  async ready(): Promise<void> {
    // no warm-up needed; HTTP endpoint is assumed reachable
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
    const url = `${this.baseURL}/embeddings`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: texts, model: this.modelId }),
      });
    } catch (e) {
      throw new EmbedderHttpError(
        `network error reaching ${url}: ${e instanceof Error ? e.message : String(e)}`,
        0,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new EmbedderHttpError(
        `embeddings request failed (${res.status}) at ${url}`,
        res.status,
        body,
      );
    }
    const json = (await res.json()) as OpenAIEmbeddingsResponse;
    if (!json.data || !Array.isArray(json.data)) {
      throw new EmbedderHttpError(
        `malformed embeddings response from ${url} (no data array)`,
        res.status,
      );
    }
    if (json.data.length !== texts.length) {
      throw new EmbedderHttpError(
        `embeddings count mismatch: requested ${texts.length}, got ${json.data.length}`,
        res.status,
      );
    }
    return json.data.map((row, i) => {
      const arr =
        row.embedding instanceof Float32Array
          ? new Float32Array(row.embedding)
          : Float32Array.from(row.embedding);
      if (arr.length !== this.dim) {
        throw new EmbedderHttpError(
          `embedding dim mismatch at index ${i}: got ${arr.length}, expected ${this.dim} (model=${this.modelId})`,
          res.status,
        );
      }
      return arr;
    });
  }
}
