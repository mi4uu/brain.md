import { Elysia, t } from "elysia";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { generateCodeVerifier, generateState } from "arctic";
import type { TokenStore } from "../auth/tokens";
import type { HandoffCodeStore } from "../auth/handoff-codes";
import type { LoginConfig } from "../auth/login-config";
import { isAllowed } from "../auth/login-config";
import { OidcProvider } from "../auth/oidc-provider";
import { GithubProvider } from "../auth/github-provider";
import {
  serializeFlowCookie,
  clearFlowCookie,
  readFlowCookie,
  serializeBindCookie,
  clearBindCookie,
  readBindCookie,
} from "../auth/login-state-cookie";

// Board-plan Part B: optional external login (OIDC + GitHub), alongside
// but separate from V53 password login and the OAuth 2.1 authorization
// server for MCP clients (oauth-flow.ts). This is a human logging into
// the web UI through a third-party identity provider, not an agent
// getting an access token.
//
// Flow:
//   GET  /api/auth/idp/:provider/start    → redirect to the provider
//   GET  /api/auth/idp/:provider/callback → provider redirects back here
//   POST /api/auth/idp/exchange           → web app trades the one-shot
//                                            handoff code for a session
//                                            token, same shape as password
//                                            login's response
//
// Errors during the flow never surface details to the browser, only a
// generic message, via a redirect back to the login page. Anything worth
// debugging goes to server logs instead, same as the OAuth 2.1 consent
// flow already does for password mismatches.

// Unlike auth-middleware.ts's originOf (used for OAuth audience binding,
// where the resource URI has to match whatever host the request actually
// came in on), these routes only need "this app's own origin" for an
// internal redirect target and a cookie's Secure flag. login-config.ts
// requires BRAINMD_PUBLIC_URL whenever an external provider is
// configured, these routes only ever run in that case, so the
// admin-configured, startup-validated value is available and is the
// right source of truth: deriving it from X-Forwarded-Host instead would
// let a request pick its own redirect target and cookie security flag.
function appOrigin(cfg: LoginConfig): string {
  return (cfg.publicUrl ?? "").replace(/\/+$/, "");
}

// arctic exports this from its oauth2 module but doesn't re-export it
// from the package root (only generateCodeVerifier/generateState are),
// so PKCE's S256 transform gets its own copy here.
function s256CodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function loginRedirect(origin: string, error?: string): Response {
  const u = new URL("/", origin);
  if (error) u.searchParams.set("login_error", error);
  return new Response(null, { status: 302, headers: { location: u.toString() } });
}

export function idpAuthRoutes(
  loginConfig: LoginConfig,
  tokens: TokenStore,
  handoffCodes: HandoffCodeStore,
) {
  const oidc = loginConfig.oidc ? new OidcProvider(loginConfig.oidc) : undefined;

  function redirectUriFor(provider: string): string {
    // BRAINMD_PUBLIC_URL is required and validated at startup whenever a
    // provider is configured, see login-config.ts.
    return `${loginConfig.publicUrl}/api/auth/idp/${provider}/callback`;
  }

  return new Elysia()
    .get("/api/auth/idp/:provider/start", async ({ params, set }) => {
      const provider = params.provider;
      const secure = appOrigin(loginConfig).startsWith("https://");
      const bind = randomBytes(32).toString("base64url");

      if (provider === "oidc" && oidc) {
        const state = generateState();
        const verifier = generateCodeVerifier();
        const nonce = randomBytes(16).toString("base64url");
        const authUrl = await oidc.buildAuthorizationUrl({
          state,
          codeChallenge: s256CodeChallenge(verifier),
          nonce,
          redirectUri: redirectUriFor("oidc"),
        });
        set.headers["set-cookie"] = serializeFlowCookie(
          { provider: "oidc", state, verifier, nonce, bind, expiresAt: Date.now() + 600_000 },
          secure,
        );
        set.status = 302;
        set.headers["location"] = authUrl.toString();
        return;
      }

      if (provider === "github" && loginConfig.github) {
        const state = generateState();
        const github = new GithubProvider(loginConfig.github, redirectUriFor("github"));
        const authUrl = github.buildAuthorizationUrl(state);
        set.headers["set-cookie"] = serializeFlowCookie(
          { provider: "github", state, verifier: "", bind, expiresAt: Date.now() + 600_000 },
          secure,
        );
        set.status = 302;
        set.headers["location"] = authUrl.toString();
        return;
      }

      set.status = 404;
      return { error: "unknown or unconfigured provider" };
    })

    .get("/api/auth/idp/:provider/callback", async ({ params, query, set, request }) => {
      const provider = params.provider;
      const origin = appOrigin(loginConfig);
      const secure = origin.startsWith("https://");
      // Clear the flow cookie unconditionally, it's single-use regardless
      // of whether this callback succeeds.
      set.headers["set-cookie"] = clearFlowCookie(secure);

      const flow = readFlowCookie(request.headers.get("cookie"));
      if (!flow || flow.provider !== provider) {
        return loginRedirect(origin, "login failed");
      }
      const returnedState = String(query.state ?? "");
      if (!returnedState || !constantTimeEq(returnedState, flow.state)) {
        return loginRedirect(origin, "login failed");
      }
      const code = String(query.code ?? "");
      if (!code) {
        return loginRedirect(origin, "login failed");
      }

      try {
        let sub: string;
        let name: string;
        let email: string;
        let groups: string[] | undefined;

        if (provider === "oidc" && oidc) {
          const identity = await oidc.exchangeAndValidate({
            code,
            codeVerifier: flow.verifier,
            redirectUri: redirectUriFor("oidc"),
            nonce: flow.nonce ?? "",
          });
          sub = `oidc:${identity.sub}`;
          name = identity.name ?? identity.email;
          email = identity.email;
          groups = identity.groups;
        } else if (provider === "github" && loginConfig.github) {
          const github = new GithubProvider(loginConfig.github, redirectUriFor("github"));
          const identity = await github.exchangeAndValidate(code);
          sub = `github:${identity.id}`;
          name = identity.name ?? identity.email;
          email = identity.email;
        } else {
          return loginRedirect(origin, "login failed");
        }

        if (!isAllowed(loginConfig, { email, groups })) {
          // eslint-disable-next-line no-console
          console.warn(`[idp-auth] rejected login from ${email} (${sub}): not on the allowlist`);
          return loginRedirect(origin, "not allowed");
        }

        const { token, expiresAt } = tokens.issue(sub, { name, email });
        const secretHash = createHash("sha256").update(flow.bind).digest("hex");
        const handoffCode = handoffCodes.issue(JSON.stringify({ token, expiresAt }), secretHash);
        const u = new URL("/", origin);
        u.searchParams.set("login_code", handoffCode);
        set.status = 302;
        set.headers["location"] = u.toString();
        // Replaces the already-cleared flow cookie's Set-Cookie with two:
        // the flow cookie stays cleared, and a fresh bind cookie carries
        // flow.bind to the exchange call that's about to follow this
        // redirect, see handoff-codes.ts.
        set.headers["set-cookie"] = [clearFlowCookie(secure), serializeBindCookie(flow.bind, secure)];
        return;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `[idp-auth] ${provider} login failed:`,
          e instanceof Error ? e.message : String(e),
        );
        return loginRedirect(origin, "login failed");
      }
    })

    .post(
      "/api/auth/idp/exchange",
      ({ body, set, request }) => {
        const secure = appOrigin(loginConfig).startsWith("https://");
        set.headers["set-cookie"] = clearBindCookie(secure);
        const bind = readBindCookie(request.headers.get("cookie"));
        // No bind cookie at all means either this isn't the browser the
        // callback redirected (login CSRF, see handoff-codes.ts) or the
        // code is just stale. Same generic error either way.
        if (!bind) {
          set.status = 400;
          return { error: "invalid or expired code" };
        }
        const secretHash = createHash("sha256").update(bind).digest("hex");
        const raw = handoffCodes.consume(body.code, secretHash);
        if (!raw) {
          set.status = 400;
          return { error: "invalid or expired code" };
        }
        const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number };
        return { token, expiresAt };
      },
      { body: t.Object({ code: t.String() }) },
    );
}
