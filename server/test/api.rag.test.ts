import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let vaultDir!: string;
let handle!: AppHandle;

beforeAll(async () => {
  vaultDir = await mkdtemp(join(tmpdir(), "brain-rag-route-"));
  handle = createApp({ vaultDir, gitAutocommit: false });
});

afterAll(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

async function fetchJson(method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await handle.app.handle(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

describe("RAG HTTP — T105-T108 / V47, V49, V51", () => {
  test("GET /api/rag/status returns enabled:false by default", async () => {
    const r = await fetchJson("GET", "/api/rag/status");
    expect(r.status).toBe(200);
    expect(r.json.enabled).toBe(false);
    expect(r.json.provider).toBe("local");
    expect(typeof r.json.dim).toBe("number");
    expect(r.json.chunks).toBe(0);
    expect(r.json.needsReindex).toBe(false);
  });

  test("GET /api/similar with no q → 400", async () => {
    const r = await fetchJson("GET", "/api/similar");
    expect(r.status).toBe(400);
  });

  test("GET /api/similar?q=hi while RAG disabled → 503 RAG_DISABLED", async () => {
    const r = await fetchJson("GET", "/api/similar?q=hi");
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("RAG_DISABLED");
  });

  test("GET /api/similar?q=hi&k=999 → 400 (range)", async () => {
    const r = await fetchJson("GET", "/api/similar?q=hi&k=999");
    expect(r.status).toBe(400);
  });

  test("POST /api/rag/reindex while RAG disabled → 503", async () => {
    const r = await fetchJson("POST", "/api/rag/reindex");
    expect(r.status).toBe(503);
    expect(r.json.code).toBe("RAG_DISABLED");
  });

  test("POST /api/rag/test with openai-compat pointing nowhere → ok:false", async () => {
    const r = await fetchJson("POST", "/api/rag/test", {
      provider: "openai-compat",
      openaiCompat: {
        baseURL: "http://127.0.0.1:1",
        model: "fake",
        dim: 4,
      },
    });
    expect(r.json.ok).toBe(false);
  });
});
