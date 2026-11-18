import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import type { LoginConfig } from "../src/auth/login-config";

let handle!: AppHandle;
let dir!: string;

const loginConfig: LoginConfig = {
  passwordLogin: true,
  publicUrl: "http://localhost",
  github: { clientId: "gh-client", clientSecret: "gh-secret" },
  allowedEmails: ["bob@example.com"],
  allowedDomains: [],
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-status-user-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false, loginConfig });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await handle.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
}

describe("GET /api/auth/status reports who is signed in", () => {
  test("no token: not authenticated, no user", async () => {
    const r = await call("GET", "/api/auth/status");
    expect(r.json.authenticated).toBe(false);
    expect(r.json.user).toBeUndefined();
  });

  test("unknown bearer: not authenticated, no user", async () => {
    const r = await call("GET", "/api/auth/status", undefined, "not-a-real-token");
    expect(r.json.authenticated).toBe(false);
    expect(r.json.user).toBeUndefined();
  });

  test("external login token: method idp with the email", async () => {
    const { token } = handle.tokenStore.issue("github:42", { name: "Bob", email: "bob@example.com" });
    const r = await call("GET", "/api/auth/status", undefined, token);
    expect(r.json.authenticated).toBe(true);
    expect(r.json.user).toEqual({ method: "idp", email: "bob@example.com", name: "Bob" });
  });

  test("password login token: method password, no email", async () => {
    const { token } = handle.tokenStore.issue();
    const r = await call("GET", "/api/auth/status", undefined, token);
    expect(r.json.authenticated).toBe(true);
    expect(r.json.user).toEqual({ method: "password" });
  });

  test("after logout the same token is signed out", async () => {
    const { token } = handle.tokenStore.issue("github:42", { name: "Bob", email: "bob@example.com" });
    const out = await call("POST", "/api/auth/logout", { token }, token);
    expect(out.status).toBe(200);
    const r = await call("GET", "/api/auth/status", undefined, token);
    expect(r.json.authenticated).toBe(false);
    expect(r.json.user).toBeUndefined();
    const tree = await handle.app.handle(
      new Request("http://localhost/api/tree", { headers: { authorization: `Bearer ${token}` } }),
    );
    expect(tree.status).toBe(401);
  });
});

describe("GET /api/auth/status with auth off", () => {
  test("authenticated without a token, and no user", async () => {
    const open = createApp({ vaultDir: dir, gitAutocommit: false });
    const res = await open.app.handle(new Request("http://localhost/api/auth/status"));
    const body = await res.json();
    expect(body).toEqual({ configured: false, authenticated: true });
  });
});
