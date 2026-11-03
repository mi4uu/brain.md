import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp, type AppHandle } from "../src/app";

// board-plan Part B regression test: the MCP OAuth 2.1 consent page
// (oauth-flow.ts) now also accepts an already-valid web session token in
// place of the password. This file checks that addition without
// disturbing the default, password-only path (the one every existing
// MCP client integration relies on).

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-consent-session-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
  await handle.app.handle(
    new Request("http://localhost/api/auth/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "correct-password" }),
    }),
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function register(): Promise<string> {
  const res = await handle.app.handle(
    new Request("http://localhost/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "test client", redirect_uris: ["https://example.com/cb"] }),
    }),
  );
  const { client_id } = await res.json();
  return client_id;
}

function authorizeParams(clientId: string) {
  const verifier = "verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  return {
    verifier,
    form: {
      client_id: clientId,
      redirect_uri: "https://example.com/cb",
      scope: "vault:read",
      state: "xyz",
      code_challenge: pkce(verifier),
      resource: "http://localhost/mcp",
    },
  };
}

function postAuthorize(form: Record<string, string>) {
  return handle.app.handle(
    new Request("http://localhost/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    }),
  );
}

describe("POST /oauth/authorize: password path is unchanged", () => {
  test("correct password still redirects with a code, no session_token sent at all", async () => {
    const clientId = await register();
    const { form } = authorizeParams(clientId);
    const res = await postAuthorize({ ...form, decision: "allow", password: "correct-password" });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("code")).not.toBeNull();
  });

  test("wrong password re-renders the consent page with an error, same as before", async () => {
    const clientId = await register();
    const { form } = authorizeParams(clientId);
    const res = await postAuthorize({ ...form, decision: "allow", password: "wrong" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Incorrect password");
  });

  test("an empty session_token field (what every un-logged-in browser sends) does not grant access", async () => {
    const clientId = await register();
    const { form } = authorizeParams(clientId);
    const res = await postAuthorize({ ...form, decision: "allow", password: "wrong", session_token: "" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Incorrect password");
  });
});

describe("POST /oauth/authorize: a logged-in web session can substitute for the password", () => {
  test("a valid session token with no password granted the code", async () => {
    const clientId = await register();
    const { form } = authorizeParams(clientId);

    const login = await handle.app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "correct-password" }),
      }),
    );
    const { token } = await login.json();

    const res = await postAuthorize({ ...form, decision: "allow", session_token: token });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("code")).not.toBeNull();
  });

  test("a garbage session token with no password is rejected, same as a wrong password", async () => {
    const clientId = await register();
    const { form } = authorizeParams(clientId);
    const res = await postAuthorize({ ...form, decision: "allow", session_token: "not-a-real-token" });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Incorrect password");
  });
});
