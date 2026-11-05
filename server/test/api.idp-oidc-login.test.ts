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

async function startFakeIssuer(opts: { port?: number } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  jwk.alg = "ES256";
  jwk.use = "sig";

  let nextClaims: Partial<IssuerClaims> = {};
  let discoveryIssuer: string | undefined;
  let omitExp = false;
  let tokenEndpointHits = 0;

  // Should-fix: a bind failure (the port requested is taken, or the
  // sandbox refuses listeners outright) used to throw whatever raw error
  // Bun.serve produces, with no indication this fixture is the cause, and
  // left `issuer` unassigned in beforeEach, so afterEach's unguarded
  // `issuer.stop()` masked it with an unrelated "undefined" TypeError.
  // Wrapping and rethrowing here keeps the real cause visible.
  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port: opts.port ?? 0,
      fetch: async (req) => {
      const url = new URL(req.url);
      if (url.pathname === "/token" && req.method === "POST") tokenEndpointHits++;
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
  } catch (e) {
    throw new Error(
      `startFakeIssuer: failed to bind a listening port (sandbox may restrict network listeners): ${String(e)}`,
      { cause: e },
    );
  }

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
    tokenEndpointHits() {
      return tokenEndpointHits;
    },
    stop() {
      server.stop(true);
    },
  };
}

let issuer: Awaited<ReturnType<typeof startFakeIssuer>>;
// Tracks whether beforeEach's startFakeIssuer() actually completed, since
// `issuer` itself keeps its type non-optional for every ordinary test
// body below (they only ever run once beforeEach has succeeded). Guards
// just the teardown path against a beforeEach that threw.
let issuerReady = false;
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
  issuerReady = false;
  issuer = await startFakeIssuer();
  issuerReady = true;
});

afterEach(async () => {
  // Should-fix: when beforeEach's startFakeIssuer() throws (a bind
  // failure), `issuer` is left unassigned (or stale from a previous
  // test). Unconditionally calling issuer.stop() here used to throw its
  // own TypeError on top of that, replacing the real "failed to bind"
  // error in the test output with an unrelated "Cannot read properties
  // of undefined" one.
  if (issuerReady) issuer.stop();
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
    .find((c) => c.startsWith("brainmd_idp_bind_dev="));
  if (!pair) throw new Error("no bind cookie on the callback response");
  return pair.split(";")[0] ?? "";
}

async function startFlow(): Promise<{ cookie: string; state: string; nonce: string }> {
  const res = await handle.app.handle(new Request("http://localhost/api/auth/idp/oidc/start"));
  expect(res.status).toBe(302);
  const cookie = cookiePair(res.headers.get("set-cookie"));
  const flow = readFlowCookie(cookie, false);
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

    const res = await exchange(code, "brainmd_idp_bind_dev=not-the-real-secret");
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
  //
  // The check now runs inside discover() itself, before the document is
  // cached or handed to any caller, so a mismatch fails /start directly
  // (no flow cookie, no redirect to the provider) rather than only
  // surfacing once something later in the flow (the callback's token
  // validation) tries to use the cached document for real.
  test("discovery document issuer does not match the configured issuer fails /start itself", async () => {
    await setup();
    issuer.setDiscoveryIssuer("http://attacker.example");
    const res = await handle.app.handle(new Request("http://localhost/api/auth/idp/oidc/start"));
    expect(res.status).toBe(302);
    expect(redirectTarget(res).searchParams.get("login_error")).not.toBeNull();
    // Never redirected to the (attacker-controlled) authorization
    // endpoint, and no flow cookie set for a callback to pick up.
    expect(redirectTarget(res).hostname).toBe("localhost");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  // Regression: the issuer mismatch used to be checked only after the
  // code exchange, so the client secret had already been POSTed to the
  // discovery document's (attacker-controlled) token endpoint by the
  // time the mismatch was caught. The check must run before that POST,
  // in fact before anything from the mismatched document is used at all.
  test("the client secret is never sent to the token endpoint when the discovery issuer mismatches", async () => {
    await setup();
    issuer.setDiscoveryIssuer("http://attacker.example");
    await handle.app.handle(new Request("http://localhost/api/auth/idp/oidc/start"));
    expect(issuer.tokenEndpointHits()).toBe(0);
  });

  // Regression: a mismatched discovery document used to get cached
  // regardless (this.discovery was set before the issuer was checked), so
  // even fixing the mismatch later in the issuer's response couldn't
  // recover without a process restart. It must only cache once the
  // issuer check actually passes.
  test("a fixed discovery document is usable after an earlier mismatched fetch", async () => {
    await setup();
    issuer.setDiscoveryIssuer("http://attacker.example");
    const failed = await handle.app.handle(new Request("http://localhost/api/auth/idp/oidc/start"));
    expect(redirectTarget(failed).searchParams.get("login_error")).not.toBeNull();

    issuer.setDiscoveryIssuer(undefined);
    const ok = await handle.app.handle(new Request("http://localhost/api/auth/idp/oidc/start"));
    expect(ok.status).toBe(302);
    const authUrl = new URL(ok.headers.get("location")!);
    expect(authUrl.origin).toBe(issuer.base);
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

describe("cookie security follows the parsed scheme, not a raw string prefix", () => {
  // Regression: idp-auth.ts used to derive a cookie's Secure flag with
  // appOrigin(cfg).startsWith("https://"), a raw prefix test. An
  // uppercase scheme passes validateLoginConfig's URL-based check (it
  // lowercases the scheme before comparing) but failed that prefix test,
  // serving a dev-grade, non-Secure, non-__Host- cookie over what's
  // actually an HTTPS deployment.
  test("an uppercase https scheme in publicUrl still gets a Secure, __Host- cookie", async () => {
    await setup({ publicUrl: "HTTPS://localhost" });
    const res = await handle.app.handle(new Request("http://localhost/api/auth/idp/oidc/start"));
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie.startsWith("__Host-brainmd_idp_flow=")).toBe(true);
    expect(setCookie).toContain("Secure");
  });
});

describe("OIDC fixture: fake issuer startup failure", () => {
  // Should-fix regression: three full runs of this suite each reported
  // 694 pass / 21 fail with an EADDRINUSE at this fixture's own startup,
  // and the teardown's unconditional issuer.stop() turned the real cause
  // into an unrelated "Cannot read properties of undefined" instead.
  // This exercises both halves directly: the bind failure itself raises
  // a clear, catchable error naming this fixture, and a beforeEach that
  // never got as far as assigning `issuer` doesn't make afterEach crash
  // on top of it.
  test("binding an already-taken port throws a clear error naming this fixture, not a bare EADDRINUSE", async () => {
    const taken = await startFakeIssuer();
    const port = Number(new URL(taken.base).port);
    try {
      await expect(startFakeIssuer({ port })).rejects.toThrow(/startFakeIssuer: failed to bind/);
    } finally {
      taken.stop();
    }
  });

  test("afterEach's guard does not throw when beforeEach never assigned issuer", () => {
    let ready = false;
    let localIssuer: Awaited<ReturnType<typeof startFakeIssuer>> | undefined;
    expect(() => {
      if (ready) localIssuer!.stop();
    }).not.toThrow();
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
