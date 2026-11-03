import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import type { LoginConfig } from "../src/auth/login-config";

// BRAINMD_PASSWORD_LOGIN=off with only an external provider configured
// means authStore.isConfigured() (the password hash store) never
// becomes true. auth-middleware.ts's original gate was "no auth
// required until a password is set", which would leave the whole vault
// open forever in this mode, there is no password to set. This covers
// the fix: the vault stays protected as soon as any login provider is
// configured, password or not.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-idp-pwoff-"));
  const loginConfig: LoginConfig = {
    passwordLogin: false,
    publicUrl: "http://localhost",
    github: { clientId: "gh-client", clientSecret: "gh-secret" },
    allowedEmails: ["bob@example.com"],
    allowedDomains: [],
  };
  handle = createApp({ vaultDir: dir, gitAutocommit: false, loginConfig });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("password login disabled, provider-only mode", () => {
  test("the vault API is protected with no bearer token, even though no password was ever set", async () => {
    const r = await handle.app.handle(new Request("http://localhost/api/tree"));
    expect(r.status).toBe(401);
  });

  test("GET /api/auth/status reports configured: true (auth is required)", async () => {
    const r = await handle.app.handle(new Request("http://localhost/api/auth/status"));
    const body = await r.json();
    expect(body.configured).toBe(true);
    expect(body.authenticated).toBe(false);
  });

  test("POST /api/auth/login is refused, password login is off", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "anything" }),
      }),
    );
    expect(r.status).toBe(403);
    const body = await r.json();
    expect(body.code).toBe("PASSWORD_LOGIN_DISABLED");
  });

  test("GET /api/auth/config reports password: false and the provider", async () => {
    const r = await handle.app.handle(new Request("http://localhost/api/auth/config"));
    const body = await r.json();
    expect(body.password).toBe(false);
    expect(body.providers).toEqual([{ id: "github", label: "GitHub" }]);
  });
});
