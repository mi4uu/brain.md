import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let vaultDir!: string;
let handle!: AppHandle;

beforeAll(async () => {
  vaultDir = await mkdtemp(join(tmpdir(), "brain-settings-"));
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

describe("settings PATCH — rag must round-trip (regression)", () => {
  test("toggling rag.enabled persists across a follow-up GET", async () => {
    const before = await fetchJson("GET", "/api/settings");
    expect(before.json.rag.enabled).toBe(false);

    const patched = await fetchJson("PATCH", "/api/settings", {
      rag: { enabled: true },
    });
    expect(patched.status).toBe(200);
    expect(patched.json.rag.enabled).toBe(true);

    const after = await fetchJson("GET", "/api/settings");
    expect(after.json.rag.enabled).toBe(true);
  });

  test("rag.provider + nested local config persists", async () => {
    const patched = await fetchJson("PATCH", "/api/settings", {
      rag: {
        provider: "openai-compat",
        openaiCompat: {
          baseURL: "http://example.test/v1",
          model: "fake-embed",
          dim: 256,
        },
      },
    });
    expect(patched.status).toBe(200);
    expect(patched.json.rag.provider).toBe("openai-compat");
    expect(patched.json.rag.openaiCompat.baseURL).toBe("http://example.test/v1");
    expect(patched.json.rag.openaiCompat.dim).toBe(256);
  });
});

describe("settings GET/PATCH never leak the embedder apiKey", () => {
  test("setting a key returns apiKeySet, never the key itself", async () => {
    const patched = await fetchJson("PATCH", "/api/settings", {
      rag: { openaiCompat: { baseURL: "http://x", model: "m", apiKey: "sk-secret", dim: 8 } },
    });
    expect(patched.json.rag.openaiCompat.apiKey).toBeUndefined();
    expect(patched.json.rag.openaiCompat.apiKeySet).toBe(true);

    const got = await fetchJson("GET", "/api/settings");
    expect(got.json.rag.openaiCompat.apiKey).toBeUndefined();
    expect(got.json.rag.openaiCompat.apiKeySet).toBe(true);
    expect(JSON.stringify(got.json)).not.toContain("sk-secret");
  });

  test("an omitted apiKey on patch leaves the stored key untouched", async () => {
    await fetchJson("PATCH", "/api/settings", {
      rag: { openaiCompat: { baseURL: "http://y", model: "m2", dim: 8 } },
    });
    const got = await fetchJson("GET", "/api/settings");
    expect(got.json.rag.openaiCompat.apiKeySet).toBe(true);
    expect(got.json.rag.openaiCompat.baseURL).toBe("http://y");
  });

  test("an explicit empty apiKey clears it", async () => {
    await fetchJson("PATCH", "/api/settings", {
      rag: { openaiCompat: { baseURL: "http://y", model: "m2", apiKey: "", dim: 8 } },
    });
    const got = await fetchJson("GET", "/api/settings");
    expect(got.json.rag.openaiCompat.apiKeySet).toBe(false);
  });
});
