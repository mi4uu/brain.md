import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

// C1: a long-lived API key authenticates on every /api path, the same as
// it does on /mcp. Before this fix, REST ignored per-folder MCP
// permissions entirely, so the same key that's locked out of a folder via
// MCP could read/write it freely through the HTTP API instead. The owner
// (password-login session) must keep full access everywhere.

let handle!: AppHandle;
let dir!: string;
let ownerToken!: string;
let apiKey!: string;

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await handle.app.handle(new Request(`http://localhost${path}`, init));
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-rest-perms-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });

  await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
  await handle.authStore.load();
  const login = await call("POST", "/api/auth/login", { password: "hunter2hunter2" });
  ownerToken = login.json.token;

  const key = await call("POST", "/api/auth/keys", { name: "agent" }, ownerToken);
  apiKey = key.json.token;

  await handle.vault.writeNote("secret/a.md", "top secret body\n#secrettag\n");
  await handle.vault.writeNote("public/b.md", "public body\n#publictag\n");
  await handle.index.updatePath("secret/a.md");
  await handle.index.updatePath("public/b.md");

  await call(
    "POST",
    "/api/folder-mcp-perms",
    { path: "secret", read: false, write: false },
    ownerToken,
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("REST respects folder perms for API-key principals", () => {
  test("owner keeps full access", async () => {
    const r = await call("GET", "/api/note/secret/a.md", undefined, ownerToken);
    expect(r.status).toBe(200);
  });

  test("API key is denied note read in a denied folder", async () => {
    const r = await call("GET", "/api/note/secret/a.md", undefined, apiKey);
    expect(r.status).toBe(403);
  });

  test("API key is denied note write in a denied folder", async () => {
    const r = await call("PUT", "/api/note/secret/a.md", { content: "x" }, apiKey);
    expect(r.status).toBe(403);
  });

  test("API key can read/write an allowed folder", async () => {
    const r = await call("GET", "/api/note/public/b.md", undefined, apiKey);
    expect(r.status).toBe(200);
  });

  test("search filters out the denied folder for an API key", async () => {
    const r = await call("GET", "/api/search?q=body", undefined, apiKey);
    const paths = r.json.map((h: { path: string }) => h.path);
    expect(paths).not.toContain("secret/a.md");
    expect(paths).toContain("public/b.md");
  });

  test("tags filter out the denied folder for an API key", async () => {
    const r = await call("GET", "/api/tags", undefined, apiKey);
    const tags = r.json.map((t: { tag: string }) => t.tag);
    expect(tags).not.toContain("secrettag");
    expect(tags).toContain("publictag");
  });

  test("tree filters out the denied folder for an API key", async () => {
    const r = await call("GET", "/api/tree", undefined, apiKey);
    expect(r.json.notes).not.toContain("secret/a.md");
    expect(r.json.notes).toContain("public/b.md");
    expect(r.json.folders).not.toContain("secret");
  });

  test("backlinks on a denied note are refused for an API key", async () => {
    const r = await call("GET", "/api/backlinks/secret/a.md", undefined, apiKey);
    expect(r.status).toBe(403);
  });

  test("rename out of a denied folder is refused for an API key", async () => {
    const r = await call(
      "POST",
      "/api/rename",
      { from: "secret/a.md", to: "public/moved.md" },
      apiKey,
    );
    expect(r.status).toBe(403);
  });

  test("git restore in a denied folder is refused for an API key", async () => {
    const r = await call(
      "POST",
      "/api/git/restore",
      { path: "secret/a.md", sha: "HEAD" },
      apiKey,
    );
    expect(r.status).toBe(403);
  });
});
