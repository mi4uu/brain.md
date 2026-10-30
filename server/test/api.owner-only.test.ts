import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

// Regression for the Codex r2 review: endpoints that administer the server
// (folder MCP perms, settings, API keys, the password, git autocommit) must
// require an owner session (or the back-compat no-password principal), and
// refuse an API key even though API keys otherwise work on /api/*.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-owner-only-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, body: unknown, bearer?: string) {
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

async function setPassword(password: string): Promise<void> {
  const r = await call("POST", "/api/auth/set", { newPassword: password });
  expect(r.status).toBe(200);
}

async function login(password: string): Promise<string> {
  const r = await call("POST", "/api/auth/login", { password });
  return r.json.token;
}

async function createApiKey(ownerToken: string): Promise<string> {
  const r = await call("POST", "/api/auth/keys", { name: "agent" }, ownerToken);
  expect(r.status).toBe(200);
  return r.json.token;
}

describe("owner-only administration endpoints", () => {
  let ownerToken!: string;
  let apiKey!: string;

  beforeEach(async () => {
    await setPassword("hunter2hunter2");
    await handle.authStore.load();
    ownerToken = await login("hunter2hunter2");
    apiKey = await createApiKey(ownerToken);
  });

  test("API key cannot list, create, or revoke API keys", async () => {
    expect((await call("GET", "/api/auth/keys", undefined, apiKey)).status).toBe(403);
    expect((await call("POST", "/api/auth/keys", { name: "x" }, apiKey)).status).toBe(403);
    expect((await call("DELETE", "/api/auth/keys/whatever", undefined, apiKey)).status).toBe(403);
    // Owner still can.
    expect((await call("GET", "/api/auth/keys", undefined, ownerToken)).status).toBe(200);
  });

  test("API key cannot set folder MCP permissions", async () => {
    const r = await call(
      "POST",
      "/api/folder-mcp-perms",
      { path: "secret", read: true, write: true },
      apiKey,
    );
    expect(r.status).toBe(403);
    const d = await call("DELETE", "/api/folder-mcp-perms/secret", undefined, apiKey);
    expect(d.status).toBe(403);
    // Owner still can.
    const ok = await call(
      "POST",
      "/api/folder-mcp-perms",
      { path: "secret", read: false, write: false },
      ownerToken,
    );
    expect(ok.status).toBe(200);
  });

  // The exact bug Codex reproduced: a restricted key POSTing its own
  // folder back open, then reading it.
  test("API key cannot re-enable its own folder restriction", async () => {
    await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: false }, ownerToken);
    const reopen = await call(
      "POST",
      "/api/folder-mcp-perms",
      { path: "secret", read: true, write: true },
      apiKey,
    );
    expect(reopen.status).toBe(403);
  });

  test("API key cannot PATCH settings", async () => {
    const r = await call("PATCH", "/api/settings", { dailyDir: "Evil" }, apiKey);
    expect(r.status).toBe(403);
    const ok = await call("PATCH", "/api/settings", { dailyDir: "Journal2" }, ownerToken);
    expect(ok.status).toBe(200);
  });

  test("API key cannot change or clear the password", async () => {
    const setR = await call(
      "POST",
      "/api/auth/set",
      { newPassword: "newpassword123", currentPassword: "hunter2hunter2" },
      apiKey,
    );
    expect(setR.status).toBe(403);
    const clearR = await call(
      "POST",
      "/api/auth/clear",
      { currentPassword: "hunter2hunter2" },
      apiKey,
    );
    expect(clearR.status).toBe(403);
  });

  test("API key cannot toggle git autocommit", async () => {
    const r = await call("POST", "/api/git/autocommit", { enabled: true }, apiKey);
    expect(r.status).toBe(403);
    const ok = await call("POST", "/api/git/autocommit", { enabled: true }, ownerToken);
    expect(ok.status).toBe(200);
  });
});

describe("owner-only administration endpoints — passwordless mode", () => {
  test("unauthenticated (open principal) can still administer when no password is set", async () => {
    const r = await call("POST", "/api/folder-mcp-perms", { path: "x", read: true, write: true });
    expect(r.status).toBe(200);
    const s = await call("PATCH", "/api/settings", { dailyDir: "Journal3" });
    expect(s.status).toBe(200);
  });
});
