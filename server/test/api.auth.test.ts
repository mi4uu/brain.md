import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { hashPassword, verifyPassword } from "../src/auth/hasher";
import { TokenStore } from "../src/auth/tokens";

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-auth-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
  // freshly created app — authStore.load() not called by the test;
  // that mirrors the unconfigured/default state.
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
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe("hasher — V53", () => {
  test("hash + verify round-trip", async () => {
    const h = await hashPassword("secret123");
    expect(typeof h).toBe("string");
    expect(h.length).toBeGreaterThan(10);
    expect(await verifyPassword("secret123", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});

describe("TokenStore — V53", () => {
  test("issued tokens validate; revoked don't", () => {
    const t = new TokenStore();
    const { token } = t.issue();
    expect(t.validate(token)).toBe(true);
    t.revoke(token);
    expect(t.validate(token)).toBe(false);
  });

  test("expired tokens fail validation", async () => {
    const t = new TokenStore(50); // 50ms TTL
    const { token } = t.issue();
    expect(t.validate(token)).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(t.validate(token)).toBe(false);
  });
});

describe("auth routes — T113, V53", () => {
  test("status default → configured:false, authenticated:true (open)", async () => {
    const r = await call("GET", "/api/auth/status");
    expect(r.status).toBe(200);
    expect(r.json.configured).toBe(false);
    expect(r.json.authenticated).toBe(true);
  });

  test("login while unconfigured → 409", async () => {
    const r = await call("POST", "/api/auth/login", { password: "x" });
    expect(r.status).toBe(409);
  });

  test("set initial password then status configured + login works", async () => {
    const s = await call("POST", "/api/auth/set", { newPassword: "topsecret" });
    expect(s.status).toBe(200);
    const status = await call("GET", "/api/auth/status");
    expect(status.json.configured).toBe(true);

    const login = await call("POST", "/api/auth/login", { password: "topsecret" });
    expect(login.status).toBe(200);
    expect(typeof login.json.token).toBe("string");
    expect(typeof login.json.expiresAt).toBe("number");

    const status2 = await call("GET", "/api/auth/status", undefined, login.json.token);
    expect(status2.json.authenticated).toBe(true);
  });

  test("set with wrong currentPassword on configured store → 401", async () => {
    await call("POST", "/api/auth/set", { newPassword: "first" });
    const r = await call("POST", "/api/auth/set", {
      newPassword: "second",
      currentPassword: "wrong",
    });
    expect(r.status).toBe(401);
  });

  test("change password with correct currentPassword succeeds", async () => {
    await call("POST", "/api/auth/set", { newPassword: "first1" });
    const { json: l } = await call("POST", "/api/auth/login", {
      password: "first1",
    });
    const r = await call(
      "POST",
      "/api/auth/set",
      { newPassword: "second", currentPassword: "first1" },
      l.token,
    );
    expect(r.status).toBe(200);
  });

  test("clear with correct password → status unconfigured", async () => {
    await call("POST", "/api/auth/set", { newPassword: "secret" });
    const { json: l } = await call("POST", "/api/auth/login", {
      password: "secret",
    });
    const r = await call(
      "POST",
      "/api/auth/clear",
      { currentPassword: "secret" },
      l.token,
    );
    expect(r.status).toBe(200);
    const status = await call("GET", "/api/auth/status");
    expect(status.json.configured).toBe(false);
  });

  test("login with wrong password → 401", async () => {
    await call("POST", "/api/auth/set", { newPassword: "secret" });
    const r = await call("POST", "/api/auth/login", { password: "nope" });
    expect(r.status).toBe(401);
  });
});

describe("auth middleware — T114, V53", () => {
  test("protected route open when unconfigured", async () => {
    const r = await call("GET", "/api/tree");
    expect(r.status).toBe(200);
  });

  test("protected route 401 once configured + no token", async () => {
    await call("POST", "/api/auth/set", { newPassword: "secret" });
    const r = await call("GET", "/api/tree");
    expect(r.status).toBe(401);
    expect(r.json.code).toBe("AUTH_REQUIRED");
  });

  test("status + login stay open even when configured", async () => {
    await call("POST", "/api/auth/set", { newPassword: "secret" });
    expect((await call("GET", "/api/auth/status")).status).toBe(200);
    expect((await call("POST", "/api/auth/login", { password: "secret" })).status).toBe(200);
  });

  test("valid bearer token lets protected route through", async () => {
    await call("POST", "/api/auth/set", { newPassword: "secret" });
    const { json } = await call("POST", "/api/auth/login", { password: "secret" });
    const r = await call("GET", "/api/tree", undefined, json.token);
    expect(r.status).toBe(200);
  });
});
