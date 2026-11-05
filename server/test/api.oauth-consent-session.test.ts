import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp, type AppHandle } from "../src/app";
import { hashPassword } from "../src/auth/hasher";

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

// Regression: the consent page's password field used to bypass both
// loginConfig.passwordLogin and the brute-force limiter, see
// password-policy.ts. These spin up their own app so they don't share
// state with the default-config tests above.
describe("POST /oauth/authorize: shares the login password policy", () => {
  async function appWithPasswordLoginOff(): Promise<{ handle: AppHandle; dir: string }> {
    const d = await mkdtemp(join(tmpdir(), "brain-consent-policy-"));
    const h = createApp({
      vaultDir: d,
      gitAutocommit: false,
      loginConfig: {
        passwordLogin: false,
        publicUrl: "http://localhost",
        github: { clientId: "gh-client", clientSecret: "gh-secret" },
        allowedEmails: ["owner@example.com"],
        allowedDomains: [],
      },
    });
    // Set a password hash directly (bypassing HTTP, which now requires
    // an owner session for /api/auth/set once an IdP is active, see
    // auth-middleware.ts): the only thing this test needs is a hash to
    // exist so it can submit a password that's actually correct.
    await h.authStore.save(await hashPassword("correct-password"));
    return { handle: h, dir: d };
  }

  test("a correct password is refused when password login is off", async () => {
    const { handle: h, dir: d } = await appWithPasswordLoginOff();
    try {
      const reg = await h.app.handle(
        new Request("http://localhost/oauth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_name: "test client", redirect_uris: ["https://example.com/cb"] }),
        }),
      );
      const { client_id } = await reg.json();
      const { form } = authorizeParams(client_id);
      const res = await h.app.handle(
        new Request("http://localhost/oauth/authorize", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ...form, decision: "allow", password: "correct-password" }).toString(),
        }),
      );
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Incorrect password");
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  test("a lockout from wrong attempts on the consent page also locks out /api/auth/login", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "brain-consent-ratelimit-"));
    const h = createApp({ vaultDir: dir2, gitAutocommit: false });
    try {
      await h.app.handle(
        new Request("http://localhost/api/auth/set", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ newPassword: "correct-password" }),
        }),
      );
      const reg = await h.app.handle(
        new Request("http://localhost/oauth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_name: "test client", redirect_uris: ["https://example.com/cb"] }),
        }),
      );
      const { client_id } = await reg.json();
      const { form } = authorizeParams(client_id);

      // MAX_FAILURES wrong passwords through the consent page.
      for (let i = 0; i < 5; i++) {
        await h.app.handle(
          new Request("http://localhost/oauth/authorize", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ ...form, decision: "allow", password: "wrong" }).toString(),
          }),
        );
      }

      const loginRes = await h.app.handle(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: "correct-password" }),
        }),
      );
      expect(loginRes.status).toBe(429);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });
});

// Regression: GET /oauth/authorize used to 503 whenever authStore.isConfigured()
// was false, even when an external provider was configured and could
// authenticate the consenting human instead. That left consent.js never
// served at all to an IdP-only deployment, so there was no way to even
// reach the "log in with the provider, then approve" path, despite POST
// already accepting a session token from that login.
describe("GET /oauth/authorize: IdP-only deployments (no password ever set)", () => {
  async function appIdpOnly(): Promise<{ handle: AppHandle; dir: string }> {
    const d = await mkdtemp(join(tmpdir(), "brain-consent-idp-only-"));
    const h = createApp({
      vaultDir: d,
      gitAutocommit: false,
      loginConfig: {
        passwordLogin: false,
        publicUrl: "http://localhost",
        github: { clientId: "gh-client", clientSecret: "gh-secret" },
        allowedEmails: ["owner@example.com"],
        allowedDomains: [],
      },
    });
    return { handle: h, dir: d };
  }

  async function registerOn(h: AppHandle): Promise<string> {
    const res = await h.app.handle(
      new Request("http://localhost/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "test client", redirect_uris: ["https://example.com/cb"] }),
      }),
    );
    const { client_id } = await res.json();
    return client_id;
  }

  function authorizeUrl(clientId: string, form: ReturnType<typeof authorizeParams>["form"]): string {
    return (
      `http://localhost/oauth/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(form.redirect_uri)}&code_challenge=${form.code_challenge}` +
      `&code_challenge_method=S256&resource=${encodeURIComponent(form.resource)}`
    );
  }

  test("the consent page is served (not a 503) with no password configured", async () => {
    const { handle: h, dir: d } = await appIdpOnly();
    try {
      const clientId = await registerOn(h);
      const { form } = authorizeParams(clientId);
      const res = await h.app.handle(new Request(authorizeUrl(clientId, form)));
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('<script src="/oauth/consent.js"></script>');
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  test("submission still requires either a password or a valid session, serving the page is not itself auth", async () => {
    const { handle: h, dir: d } = await appIdpOnly();
    try {
      const clientId = await registerOn(h);
      const { form } = authorizeParams(clientId);
      const res = await h.app.handle(
        new Request("http://localhost/oauth/authorize", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ ...form, decision: "allow" }).toString(),
        }),
      );
      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location")!);
      expect(location.searchParams.get("error")).toBe("server_error");
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  test("no password AND no external provider still 503s, same as before", async () => {
    const d = await mkdtemp(join(tmpdir(), "brain-consent-noauth-"));
    const h = createApp({
      vaultDir: d,
      gitAutocommit: false,
      loginConfig: {
        passwordLogin: true,
        allowedEmails: [],
        allowedDomains: [],
      },
    });
    try {
      const clientId = await registerOn(h);
      const { form } = authorizeParams(clientId);
      const res = await h.app.handle(new Request(authorizeUrl(clientId, form)));
      expect(res.status).toBe(503);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});

describe("GET /oauth/authorize: the consent page's script is same-origin, not inline", () => {
  // CSP is script-src 'self' with no nonce (api.security-headers.test.ts
  // covers the header itself); an inline <script> would be silently
  // blocked by the browser, leaving anyone without a password (IdP-only
  // deployments) unable to prefill the session token and so unable to
  // approve an MCP client at all.
  test("the consent page has no inline script, only a same-origin <script src>", async () => {
    const clientId = await register();
    const { form } = authorizeParams(clientId);
    const url =
      `http://localhost/oauth/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(form.redirect_uri)}&code_challenge=${form.code_challenge}` +
      `&code_challenge_method=S256&resource=${encodeURIComponent(form.resource)}`;
    const res = await handle.app.handle(new Request(url));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<script src="/oauth/consent.js"></script>');
    expect(html).not.toMatch(/<script>[^<]/);
  });

  test("GET /oauth/consent.js serves the script referenced by the consent page", async () => {
    const res = await handle.app.handle(new Request("http://localhost/oauth/consent.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const body = await res.text();
    expect(body).toContain("brain.auth.token");
  });
});
