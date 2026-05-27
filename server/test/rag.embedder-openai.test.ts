import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  EmbedderHttpError,
  OpenAICompatEmbedder,
  normalizeBaseURL,
} from "../src/rag/embedder-openai";

const realFetch = globalThis.fetch;

interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function mockFetch(handler: (req: CapturedCall) => Response | Promise<Response>): {
  calls: CapturedCall[];
  restore: () => void;
} {
  const calls: CapturedCall[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
        headers[k.toLowerCase()] = v;
      }
    }
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const call: CapturedCall = { url, method, headers, body };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = realFetch) };
}

describe("normalizeBaseURL", () => {
  test("appends /v1 when absent", () => {
    expect(normalizeBaseURL("http://localhost:11434")).toBe(
      "http://localhost:11434/v1",
    );
  });
  test("keeps existing /v1", () => {
    expect(normalizeBaseURL("http://localhost:11434/v1")).toBe(
      "http://localhost:11434/v1",
    );
  });
  test("strips trailing slash and then appends /v1", () => {
    expect(normalizeBaseURL("https://api.openai.com/")).toBe(
      "https://api.openai.com/v1",
    );
  });
  test("respects /v2 if present (Cohere-style)", () => {
    expect(normalizeBaseURL("https://api.cohere.ai/v2")).toBe(
      "https://api.cohere.ai/v2",
    );
  });
});

describe("OpenAICompatEmbedder — V49", () => {
  let mock!: ReturnType<typeof mockFetch>;
  afterEach(() => mock?.restore());

  test("empty input → empty array, no HTTP call", async () => {
    mock = mockFetch(() => new Response("{}", { status: 200 }));
    const e = new OpenAICompatEmbedder({
      baseURL: "http://x",
      model: "m",
      dim: 4,
    });
    const r = await e.embed([]);
    expect(r).toEqual([]);
    expect(mock.calls.length).toBe(0);
  });

  test("POSTs to /v1/embeddings with input + model + optional Bearer", async () => {
    mock = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            data: [
              { embedding: [0.1, 0.2, 0.3, 0.4] },
              { embedding: [0.5, 0.6, 0.7, 0.8] },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const e = new OpenAICompatEmbedder({
      baseURL: "http://localhost:11434",
      model: "nomic-embed-text",
      apiKey: "sk-test",
      dim: 4,
    });
    const out = await e.embed(["a", "b"]);
    expect(out.length).toBe(2);
    // Float32 precision loss: round-trip via Number for comparison
    const v0 = Array.from(out[0]!).map((x) => Math.round(x * 10) / 10);
    expect(v0).toEqual([0.1, 0.2, 0.3, 0.4]);

    expect(mock.calls.length).toBe(1);
    const call = mock.calls[0]!;
    expect(call.url).toBe("http://localhost:11434/v1/embeddings");
    expect(call.method).toBe("POST");
    expect(call.headers.authorization).toBe("Bearer sk-test");
    expect(call.body).toEqual({ input: ["a", "b"], model: "nomic-embed-text" });
  });

  test("omits Authorization header when apiKey is absent or empty", async () => {
    mock = mockFetch(
      () =>
        new Response(
          JSON.stringify({ data: [{ embedding: [0, 0, 0, 0] }] }),
          { status: 200 },
        ),
    );
    const e = new OpenAICompatEmbedder({
      baseURL: "http://x",
      model: "m",
      dim: 4,
    });
    await e.embed(["hi"]);
    expect(mock.calls[0]!.headers.authorization).toBeUndefined();
  });

  test("HTTP 4xx → EmbedderHttpError with status", async () => {
    mock = mockFetch(() => new Response("nope", { status: 401 }));
    const e = new OpenAICompatEmbedder({
      baseURL: "http://x",
      model: "m",
      dim: 4,
    });
    try {
      await e.embed(["x"]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EmbedderHttpError);
      expect((err as EmbedderHttpError).status).toBe(401);
    }
  });

  test("dim mismatch → EmbedderHttpError", async () => {
    mock = mockFetch(
      () =>
        new Response(
          JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), // 3 dims
          { status: 200 },
        ),
    );
    const e = new OpenAICompatEmbedder({
      baseURL: "http://x",
      model: "m",
      dim: 4,
    });
    expect(e.embed(["hi"])).rejects.toThrow(EmbedderHttpError);
  });
});
