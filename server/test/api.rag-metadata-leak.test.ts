import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import type { Embedder } from "../src/rag/provider";
import type { ProviderId } from "../src/rag/types";

// Regression for Codex r2 #5: /api/similar returned store results with no
// folder-perm filter at all, and /api/resolve + /api/aliases returned
// matches regardless of read permission.

class FakeEmbedder implements Embedder {
  readonly providerId: ProviderId = "local";
  readonly modelId = "fake-model";
  constructor(readonly dim: number) {}
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    // Every text embeds to the same vector; search ranking doesn't matter
    // for this test, only that every row is a candidate hit.
    return texts.map(() => new Float32Array(this.dim).fill(1));
  }
}

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-rag-leak-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const r = await handle.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

describe("RAG / resolve metadata filtered by folder perms", () => {
  let apiKey!: string;

  beforeEach(async () => {
    (handle.ragPipeline as unknown as { embedder: Embedder }).embedder = new FakeEmbedder(
      handle.ragStore.dim,
    );
    await call("PATCH", "/api/settings", { rag: { enabled: true } });

    await handle.vault.writeNote("public/a.md", "# Public\n\npublic content\n");
    await handle.vault.writeNote("secret/b.md", "# Secret\n\nsecret content\n\n## alias-target\n");
    await handle.vault.readNote("secret/b.md"); // sanity
    await handle.index.updatePath("public/a.md");
    await handle.index.updatePath("secret/b.md");
    await handle.ragPipeline.indexNote("public/a.md");
    await handle.ragPipeline.indexNote("secret/b.md");

    await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
    const login = await call("POST", "/api/auth/login", { password: "hunter2hunter2" });
    const ownerToken = login.json.token;
    const keyRes = await call("POST", "/api/auth/keys", { name: "agent" }, ownerToken);
    apiKey = keyRes.json.token;
    await call(
      "POST",
      "/api/folder-mcp-perms",
      { path: "secret", read: false, write: true },
      ownerToken,
    );
  });

  test("/api/similar excludes denied-folder hits for an API key", async () => {
    const r = await call("GET", "/api/similar?q=content&k=50", undefined, apiKey);
    expect(r.status).toBe(200);
    const paths = (r.json as Array<{ path: string }>).map((h) => h.path);
    expect(paths).not.toContain("secret/b.md");
    expect(paths).toContain("public/a.md");
  });

  test("/api/resolve hides a denied-folder match", async () => {
    const r = await call("GET", "/api/resolve?name=b", undefined, apiKey);
    expect(r.status).toBe(200);
    expect(r.json.matches).not.toContain("secret/b.md");
  });

  test("/api/aliases hides a denied-folder path, keeps unrelated aliases", async () => {
    await handle.vault.writeNote(
      "public/c.md",
      "---\naliases: [shared-alias]\n---\n# C\n",
    );
    await handle.vault.writeNote(
      "secret/d.md",
      "---\naliases: [shared-alias]\n---\n# D\n",
    );
    await handle.index.updatePath("public/c.md");
    await handle.index.updatePath("secret/d.md");

    const r = await call("GET", "/api/aliases", undefined, apiKey);
    expect(r.status).toBe(200);
    expect(r.json["shared-alias"]).toEqual(["public/c.md"]);
  });
});
