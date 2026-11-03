import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { readFlowCookie } from "../src/auth/login-state-cookie";
import type { LoginConfig } from "../src/auth/login-config";

// End-to-end through the real routes (start → callback → exchange), with
// GitHub's own HTTP API mocked, the task spec's "mock fetch for GitHub"
// case, exercised at the route level rather than just GithubProvider in
// isolation (see auth.github-provider.test.ts for that).

let originalFetch: typeof fetch;
let handle!: AppHandle;
let dir!: string;

function mockGithubFetch(opts: { primaryVerified: boolean }) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "gh-token", token_type: "bearer" }), { status: 200 });
    }
    if (url === "https://api.github.com/user") {
      return new Response(JSON.stringify({ id: 7, name: "Bob", login: "bob" }), { status: 200 });
    }
    if (url === "https://api.github.com/user/emails") {
      return new Response(
        JSON.stringify([{ email: "bob@example.com", primary: true, verified: opts.primaryVerified }]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

async function setup(overrides: Partial<LoginConfig> = {}) {
  dir = await mkdtemp(join(tmpdir(), "brain-idp-github-"));
  const loginConfig: LoginConfig = {
    passwordLogin: true,
    publicUrl: "http://localhost",
    github: { clientId: "gh-client", clientSecret: "gh-secret" },
    allowedEmails: ["bob@example.com"],
    allowedDomains: [],
    ...overrides,
  };
  handle = createApp({ vaultDir: dir, gitAutocommit: false, loginConfig });
}

afterEach(async () => {
  if (originalFetch) globalThis.fetch = originalFetch;
  if (dir) await rm(dir, { recursive: true, force: true });
});

function cookiePair(setCookieHeader: string | null): string {
  if (!setCookieHeader) throw new Error("no set-cookie header");
  return setCookieHeader.split(";")[0] ?? "";
}

describe("GitHub login", () => {
  test("happy path: verified primary email issues a working session token", async () => {
    mockGithubFetch({ primaryVerified: true });
    await setup();

    const startRes = await handle.app.handle(new Request("http://localhost/api/auth/idp/github/start"));
    expect(startRes.status).toBe(302);
    const cookie = cookiePair(startRes.headers.get("set-cookie"));
    const flow = readFlowCookie(cookie);
    if (!flow) throw new Error("flow cookie did not round-trip");

    const cbUrl = new URL("http://localhost/api/auth/idp/github/callback");
    cbUrl.searchParams.set("state", flow.state);
    cbUrl.searchParams.set("code", "some-code");
    const cbRes = await handle.app.handle(new Request(cbUrl, { headers: { cookie } }));
    expect(cbRes.status).toBe(302);
    const location = new URL(cbRes.headers.get("location")!, "http://localhost");
    const code = location.searchParams.get("login_code");
    expect(code).not.toBeNull();

    const exchangeRes = await handle.app.handle(
      new Request("http://localhost/api/auth/idp/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
    );
    expect(exchangeRes.status).toBe(200);
    const body = await exchangeRes.json();
    const statusRes = await handle.app.handle(
      new Request("http://localhost/api/auth/status", {
        headers: { authorization: `Bearer ${body.token}` },
      }),
    );
    expect((await statusRes.json()).authenticated).toBe(true);
  });

  test("unverified primary email redirects to the login page with a generic error", async () => {
    mockGithubFetch({ primaryVerified: false });
    await setup();

    const startRes = await handle.app.handle(new Request("http://localhost/api/auth/idp/github/start"));
    const cookie = cookiePair(startRes.headers.get("set-cookie"));
    const flow = readFlowCookie(cookie);
    if (!flow) throw new Error("flow cookie did not round-trip");

    const cbUrl = new URL("http://localhost/api/auth/idp/github/callback");
    cbUrl.searchParams.set("state", flow.state);
    cbUrl.searchParams.set("code", "some-code");
    const cbRes = await handle.app.handle(new Request(cbUrl, { headers: { cookie } }));
    expect(cbRes.status).toBe(302);
    const location = new URL(cbRes.headers.get("location")!, "http://localhost");
    expect(location.searchParams.get("login_error")).not.toBeNull();
    expect(location.searchParams.get("login_code")).toBeNull();
  });
});
