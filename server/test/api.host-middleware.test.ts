import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-host-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Host header allowlist (DNS-rebinding guard)", () => {
  test("default allowlist accepts localhost", async () => {
    handle = createApp({ vaultDir: dir, gitAutocommit: false });
    const r = await handle.app.handle(new Request("http://localhost/health"));
    expect(r.status).toBe(200);
  });

  test("a hostname not in the allowlist is rejected", async () => {
    handle = createApp({ vaultDir: dir, gitAutocommit: false });
    const r = await handle.app.handle(
      new Request("http://localhost/health", { headers: { host: "evil.example.com" } }),
    );
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.code).toBe("HOST_NOT_ALLOWED");
  });

  test("x-forwarded-host is checked (reverse-proxy / tunnel setups)", async () => {
    handle = createApp({ vaultDir: dir, gitAutocommit: false });
    const r = await handle.app.handle(
      new Request("http://localhost/health", {
        headers: { host: "127.0.0.1:3000", "x-forwarded-host": "evil.example.com" },
      }),
    );
    expect(r.status).toBe(400);
  });

  test("an extra configured host is accepted", async () => {
    handle = createApp({
      vaultDir: dir,
      gitAutocommit: false,
      allowedHosts: ["localhost", "127.0.0.1", "[::1]", "brain.example.com"],
    });
    const r = await handle.app.handle(
      new Request("http://localhost/health", { headers: { host: "brain.example.com" } }),
    );
    expect(r.status).toBe(200);
  });
});

describe("Origin check on state-changing requests", () => {
  beforeEach(() => {
    handle = createApp({ vaultDir: dir, gitAutocommit: false });
  });

  // Codex r2 #9: with no password configured, a GET also returns real
  // content (any /api/* route), so a foreign Origin must be rejected on
  // reads too, not just on writes — otherwise a page on an attacker's
  // origin that rebinds its own hostname to this server can read the
  // vault same-origin.
  test("GET with a foreign Origin is rejected", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/health", {
        headers: { host: "localhost", origin: "https://evil.example.com" },
      }),
    );
    expect(r.status).toBe(403);
  });

  test("GET with a matching Origin is allowed", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/health", {
        headers: { host: "localhost", origin: "http://localhost" },
      }),
    );
    expect(r.status).toBe(200);
  });

  test("GET with no Origin header is allowed (non-browser clients)", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/health", { headers: { host: "localhost" } }),
    );
    expect(r.status).toBe(200);
  });

  test("POST with a foreign Origin is rejected", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/api/auth/status", {
        method: "POST",
        headers: { host: "localhost", origin: "https://evil.example.com" },
      }),
    );
    expect(r.status).toBe(403);
  });

  test("POST with a matching Origin is allowed through", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/api/auth/status", {
        method: "POST",
        headers: { host: "localhost", origin: "http://localhost" },
      }),
    );
    expect(r.status).not.toBe(403);
  });

  test("POST with no Origin header is allowed (non-browser clients)", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/api/auth/status", {
        method: "POST",
        headers: { host: "localhost" },
      }),
    );
    expect(r.status).not.toBe(403);
  });

  test("x-forwarded-host cannot whitelist a foreign Host", async () => {
    handle = createApp({ vaultDir: dir, gitAutocommit: false });
    const r = await handle.app.handle(
      new Request("http://localhost/health", {
        headers: { host: "evil.example.com", "x-forwarded-host": "localhost" },
      }),
    );
    expect(r.status).toBe(400);
  });

  test("with a password set, any Host is accepted (bearer auth covers it)", async () => {
    handle = createApp({ vaultDir: dir, gitAutocommit: false });
    const set = await handle.app.handle(
      new Request("http://localhost/api/auth/set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: "hunter2hunter2" }),
      }),
    );
    expect(set.status).toBe(200);
    const health = await handle.app.handle(
      new Request("http://localhost/health", { headers: { host: "brain.example.com" } }),
    );
    expect(health.status).toBe(200);
    const tree = await handle.app.handle(
      new Request("http://localhost/api/tree", { headers: { host: "brain.example.com" } }),
    );
    expect(tree.status).toBe(401);
  });
});
