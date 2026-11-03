import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
import { createApp, type AppHandle } from "../src/app";
import { readFlowCookie } from "../src/auth/login-state-cookie";
import type { LoginConfig } from "../src/auth/login-config";

// Spins up a real OIDC issuer (discovery + JWKS + token endpoint) on a
// loopback port, the way the task spec asks for, so the full discovery →
// JWKS → ID token validation path gets exercised for real instead of
// mocked piece by piece.

interface IssuerClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  nonce: string;
  aud: string;
  iss: string;
  exp: number; // seconds since epoch
  name?: string;
}

async function startFakeIssuer() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "ES256";
  jwk.use = "sig";

  let nextClaims: Partial<IssuerClaims> = {};
  let discoveryIssuer: string | undefined;
  let omitExp = false;

  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/.well-known/openid-configuration") {
        return Response.json({
          issuer: discoveryIssuer ?? base(),
          authorization_endpoint: `${base()}/authorize`,
          token_endpoint: `${base()}/token`,
          jwks_uri: `${base()}/jwks`,
        });
      }
      if (url.pathname === "/jwks") {
        return Response.json({ keys: [jwk] });
      }
      if (url.pathname === "/token" && req.method === "POST") {
        const claims: IssuerClaims = {
          sub: "user-1",
          email: "alice@example.com",
          email_verified: true,
          nonce: "",
          aud: "test-client",
          iss: base(),
          exp: Math.floor(Date.now() / 1000) + 300,
          name: "Alice",
          ...nextClaims,
        };
        let builder = new SignJWT({
          email: claims.email,
          email_verified: claims.email_verified,
          nonce: claims.nonce,
          name: claims.name,
        })
          .setProtectedHeader({ alg: "ES256", kid: "test-key-1" })
          .setSubject(claims.sub)
          .setAudience(claims.aud)
          .setIssuer(claims.iss);
        if (!omitExp) builder = builder.setExpirationTime(claims.exp).setIssuedAt();
        const idToken = await builder.sign(privateKey);
        return Response.json({
          access_token: "fake-access-token",
          id_token: idToken,
          token_type: "Bearer",
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  function base(): string {
    return `http://127.0.0.1:${server.port}`;
  }

  return {
    base: base(),
    setNextClaims(c: Partial<IssuerClaims>) {
      nextClaims = c;
    },
    setDiscoveryIssuer(iss: string | undefined) {
      discoveryIssuer = iss;
    },
    setOmitExp(v: boolean) {
      omitExp = v;
    },
    stop() {
      server.stop(true);
    },
  };
}

let issuer: Awaited<ReturnType<typeof startFakeIssuer>>;
let handle!: AppHandle;
let dir!: string;

async function setup(overrides: Partial<LoginConfig> = {}) {
  dir = await mkdtemp(join(tmpdir(), "brain-idp-oidc-"));
  const loginConfig: LoginConfig = {
    passwordLogin: true,
    publicUrl: "http://localhost",
    oidc: {
      issuer: issuer.base,
      clientId: "test-client",
      clientSecret: "test-secret",
      name: "Test IdP",
      scopes: ["openid", "email", "profile"],
    },
    allowedEmails: ["alice@example.com"],
    allowedDomains: [],
    ...overrides,
  };
  handle = createApp({ vaultDir: dir, gitAutocommit: false, loginConfig });
}

beforeEach(async () => {
  issuer = await startFakeIssuer();
});

afterEach(async () => {
  issuer.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

function cookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error("no set-cookie header");
  return setCookieHeader.split(";")[0] ?? "";
}

// The callback sets two cookies (clear the flow cookie, set the bind
// cookie), getSetCookie() is the standard way to read multiple Set-Cookie
// headers off one Response.
function bindCookieFrom(res: Response): string {
  const pair = res.headers
    .getSetCookie()
    .find((c) => c.startsWith("brainmd_idp_bind="));
  if (!pair) throw new Error("no bind cookie on the callback response");
  return pair.split(";")[0] ?? "";
}

async function startFlow(): Promise<{ cookie: string; state: string; nonce: string }> {
  const res = await handle.app.handle(new Request("http://localhost/api/auth/idp/oidc/start"));
  expect(res.status).toBe(302);
  const cookie = cookiePair(res.headers.get("set-cookie"));
  const flow = readFlowCookie(cookie);
  if (!flow) throw new Error("flow cookie did not round-trip");
  return { cookie, state: flow.state, nonce: flow.nonce ?? "" };
}

async function callback(params: { cookie: string; state: string; code?: string }) {
  const url = new URL("http://localhost/api/auth/idp/oidc/callback");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code", params.code ?? "fake-code");
  return handle.app.handle(new Request(url, { headers: { cookie: params.cookie } }));
}

// Exchanges a handoff code the way the browser that ran the flow would:
// carrying the bind cookie the callback just set.
async function exchange(code: string | null, bindCookie: string) {
  return handle.app.handle(
    new Request("http://localhost/api/auth/idp/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: bindCookie },
      body: JSON.stringify({ code }),
    }),
  );
}

function redirectTarget(res: Response): URL {
  const loc = res.headers.get("location");
  if (!loc) throw new Error("no location header");
  return new URL(loc, "http://localhost");
}

describe("OIDC login: happy path", () => {
  test("start → callback → exchange yields a valid session token", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });

    const cbRes = await callback({ cookie, state });
    expect(cbRes.status).toBe(302);
    const target = redirectTarget(cbRes);
    expect(target.pathname).toBe("/");
    const code = target.searchParams.get("login_code");
    expect(code).not.toBeNull();

    const exchangeRes = await exchange(code, bindCookieFrom(cbRes));
    expect(exchangeRes.status).toBe(200);
    const body = await exchangeRes.json();
    expect(typeof body.token).toBe("string");

    // The issued session token behaves exactly like a password-login one.
    const statusRes = await handle.app.handle(
      new Request("http://localhost/api/auth/status", {
        headers: { authorization: `Bearer ${body.token}` },
      }),
    );
    const status = await statusRes.json();
    expect(status.authenticated).toBe(true);
  });

  // Regression: a trailing slash on BRAINMD_PUBLIC_URL used to be
  // concatenated straight onto the callback path, producing
  // ".../idp/oidc//callback" (double slash, 404 at the real callback).
  test("a trailing slash on publicUrl doesn't double up in the callback redirect_uri", async () => {
    await setup({ publicUrl: "http://localhost/" });
    const res = await handle.app.handle(new Request("http://localhost/api/auth/idp/oidc/start"));
    expect(res.status).toBe(302);
    const authUrl = new URL(res.headers.get("location")!);
    expect(authUrl.searchParams.get("redirect_uri")).toBe("http://localhost/api/auth/idp/oidc/callback");
  });

  test("the handoff code is single-use, replaying it fails", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    const cbRes = await callback({ cookie, state });
    const code = redirectTarget(cbRes).searchParams.get("login_code");
    const bindCookie = bindCookieFrom(cbRes);

    const first = await exchange(code, bindCookie);
    expect(first.status).toBe(200);

    const second = await exchange(code, bindCookie);
    expect(second.status).toBe(400);
  });

  // Login CSRF regression: a browser that never ran the flow (no bind
  // cookie) must not be able to redeem a code it merely learned the
  // value of, e.g. handed a login_code URL by the person who ran it.
  test("exchanging a valid code without the bind cookie fails", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    const cbRes = await callback({ cookie, state });
    const code = redirectTarget(cbRes).searchParams.get("login_code");

    const res = await exchange(code, "");
    expect(res.status).toBe(400);
  });

  test("exchanging a valid code with someone else's bind cookie fails", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    const cbRes = await callback({ cookie, state });
    const code = redirectTarget(cbRes).searchParams.get("login_code");

    const res = await exchange(code, "brainmd_idp_bind=not-the-real-secret");
    expect(res.status).toBe(400);
  });
});

describe("OIDC login: rejected flows redirect to the login page with a generic error", () => {
  test("wrong nonce", async () => {
    await setup();
    const { cookie, state } = await startFlow();
    issuer.setNextClaims({ nonce: "not-the-real-nonce" });
    const res = await callback({ cookie, state });
    expect(res.status).toBe(302);
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
    expect(redirectTarget(res).searchParams.get("login_code")).toBeNull();
  });

  test("wrong audience", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce, aud: "some-other-client" });
    const res = await callback({ cookie, state });
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
  });

  test("expired token", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce, exp: Math.floor(Date.now() / 1000) - 60 });
    const res = await callback({ cookie, state });
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
  });

  test("email_verified false", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce, email_verified: false });
    const res = await callback({ cookie, state });
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
  });

  test("email not on the allowlist", async () => {
    await setup({ allowedEmails: ["someone-else@example.com"] });
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    const res = await callback({ cookie, state });
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
  });

  test("state mismatch", async () => {
    await setup();
    const { cookie, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    const res = await callback({ cookie, state: "a-completely-different-state" });
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
  });

  // Regression: discovery's issuer field used to be trusted as-is and
  // handed straight to jwtVerify, a discovery document (served over
  // whatever the issuer URL happens to resolve to) claiming a different
  // issuer than configured was accepted.
  test("discovery document issuer does not match the configured issuer", async () => {
    await setup();
    // Discovery is fetched (and cached) during /start, the override has
    // to be in place before that first fetch.
    issuer.setDiscoveryIssuer("http://attacker.example");
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    const res = await callback({ cookie, state });
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
    expect(redirectTarget(res).searchParams.get("login_code")).toBeNull();
  });

  // Regression: jose's requiredClaims defaulted to empty, an ID token
  // with no exp at all (not merely expired) passed jwtVerify.
  test("ID token with no exp claim at all is rejected", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    issuer.setOmitExp(true);
    const res = await callback({ cookie, state });
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
    expect(redirectTarget(res).searchParams.get("login_code")).toBeNull();
  });
});

describe("OIDC login does not affect password login", () => {
  test("password login still works with an OIDC provider configured", async () => {
    await setup();
    // With an IdP active, setting the first password needs an owner
    // session (see auth-middleware.ts), log in via OIDC first to get one.
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    const cbRes = await callback({ cookie, state });
    const code = redirectTarget(cbRes).searchParams.get("login_code");
    const { token: ownerToken } = await (await exchange(code, bindCookieFrom(cbRes))).json();

    const setRes = await handle.app.handle(
      new Request("http://localhost/api/auth/set", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ newPassword: "correct-password" }),
      }),
    );
    expect(setRes.status).toBe(200);
    const res = await handle.app.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "correct-password" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
  });

  test("GET /api/auth/config reports both password and the OIDC provider", async () => {
    await setup();
    const res = await handle.app.handle(new Request("http://localhost/api/auth/config"));
    const body = await res.json();
    expect(body.password).toBe(true);
    expect(body.providers).toEqual([{ id: "oidc", label: "Test IdP" }]);
  });
});

describe("anonymous instance takeover regression", () => {
  // auth-middleware.ts used to let POST /api/auth/set through with no
  // bearer at all whenever auth.isConfigured() was false, even with an
  // IdP active: principalFor() defaults to the back-compat "open"
  // principal, which requireOwner() treats as owner, so anyone could set
  // the first password before the real owner ever logged in.
  test("POST /api/auth/set with no bearer is refused while an IdP is active and no password is set", async () => {
    await setup();
    const res = await handle.app.handle(
      new Request("http://localhost/api/auth/set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: "attacker-password" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  test("a valid owner session (from logging in via the IdP) can set the first password", async () => {
    await setup();
    const { cookie, state, nonce } = await startFlow();
    issuer.setNextClaims({ nonce });
    const cbRes = await callback({ cookie, state });
    const code = redirectTarget(cbRes).searchParams.get("login_code");
    const { token } = await (await exchange(code, bindCookieFrom(cbRes))).json();

    const res = await handle.app.handle(
      new Request("http://localhost/api/auth/set", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ newPassword: "owner-chosen-password" }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("login config validation at startup", () => {
  test("createApp throws when password login is off with no provider configured", async () => {
    const d = await mkdtemp(join(tmpdir(), "brain-idp-badcfg-"));
    try {
      expect(() =>
        createApp({
          vaultDir: d,
          gitAutocommit: false,
          loginConfig: {
            passwordLogin: false,
            allowedEmails: [],
            allowedDomains: [],
          },
        }),
      ).toThrow();
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});
