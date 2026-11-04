import { Elysia } from "elysia";
import type { AuthStore } from "../auth/store";
import type { TokenStore } from "../auth/tokens";
import type { OAuthStore } from "../auth/oauth-store";
import type { APIKeyStore } from "../auth/api-keys";
import type { OAuthClientStore } from "../auth/oauth-clients";
import type { Principal } from "./principal";
import {
  identityContext,
  localIdentity,
  apiKeyIdentity,
  oauthClientIdentity,
  externalIdentity,
} from "../auth/identity";
import { originOf } from "./origin";

// Who authenticated a given request, keyed by the exact Request instance
// Elysia hands to onRequest, the same object flows through to route
// handlers for the lifetime of that request, so routes can look themselves
// up here instead of re-deriving the bearer kind. Falls back to "open"
// (unrestricted) for anything not found, which only happens for requests
// that never went through this middleware (tests constructing routes
// directly) or auth.json being unconfigured.
const principals = new WeakMap<Request, Principal>();

export function principalFor(request: Request): Principal {
  return principals.get(request) ?? { kind: "open" };
}

// V53: protect every /api/* (except /api/auth/{status,login}) + /mcp/*
// (including /mcp itself, not just /mcp/sub-paths) once auth.json exists.
// When unconfigured, the middleware is a no-op so fresh installs work
// without setup.
//
// V65 (OAuth 2.1 discovery): when an unauthenticated request hits a
// protected path, the 401 response MUST include a WWW-Authenticate
// header pointing at the Protected Resource Metadata document so MCP
// clients can auto-discover the authorization server (RFC 9728 §5.1).

const OPEN_PATHS = new Set([
  "/api/auth/status",
  "/api/auth/login",
  // board-plan Part B: which login methods are enabled, for the login
  // page to render before anyone is authenticated.
  "/api/auth/config",
  // V64: OAuth discovery endpoints MUST be reachable without a token —
  // the whole point is to let a client learn how to obtain one.
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
]);

const OPEN_PREFIXES = [
  "/oauth/", // /oauth/authorize, /oauth/token, /oauth/register
  // board-plan Part B: external login start/callback/exchange, a human
  // hitting these has no session yet by definition.
  "/api/auth/idp/",
];

function bearer(req: Request): string | undefined {
  const a = req.headers.get("authorization");
  if (!a) return undefined;
  const m = /^Bearer\s+(.+)$/.exec(a);
  return m ? m[1] : undefined;
}

export function authMiddleware(
  auth: AuthStore,
  tokens: TokenStore,
  oauth?: OAuthStore,
  keys?: APIKeyStore,
  oauthClients?: OAuthClientStore,
  owner: { name: string; email: string } = { name: "brain.md owner", email: "owner@brain.local" },
  // board-plan Part B: an external login provider can be the ONLY way in
  // (BRAINMD_PASSWORD_LOGIN=off), in which case auth.isConfigured() (the
  // password hash store) stays empty forever. Without this flag the
  // bearer checks below would never run and the vault would be wide open.
  externalLoginConfigured: boolean = false,
) {
  return new Elysia().onRequest(({ request, set }) => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Identity plumbing (board-plan P2): default every request to the
    // local owner's identity before any credential check, so paths that
    // skip the bearer checks below (unconfigured auth, open paths) still
    // give autocommit.notify() something sane to attribute a commit to.
    // Overwritten further down once a specific credential resolves.
    //
    // When auth is entirely unconfigured (no password set, no external
    // login provider), there is no credential to attribute to, so this
    // must stay the legacy git default identity rather than `owner`
    // (config.ownerName/ownerEmail): using `owner` here changed the
    // autocommit author for every install that never opted into auth,
    // which v0.4.12 never did.
    identityContext.enterWith(
      auth.isConfigured() || externalLoginConfigured
        ? localIdentity(owner.name, owner.email)
        : localIdentity("brain.md", "brain@local"),
    );

    // BRAINMD_LOG_OAUTH=1 enables verbose tracing of every /oauth/* and
    // /.well-known/* request so we can diagnose what spec-incompliant
    // MCP clients (looking at you, current Claude.ai connector) actually
    // send. Off by default — log volume would be silly otherwise.
    if (
      process.env.BRAINMD_LOG_OAUTH === "1" &&
      (path.startsWith("/oauth/") || path.startsWith("/.well-known/"))
    ) {
      const ct = request.headers.get("content-type") ?? "-";
      const ua = (request.headers.get("user-agent") ?? "-").slice(0, 80);
      // eslint-disable-next-line no-console
      console.error(
        `[oauth-trace] ${request.method} ${path}${url.search} ct=${ct} ua=${ua}`,
      );
    }

    if (!auth.isConfigured() && !externalLoginConfigured) {
      principals.set(request, { kind: "open" });
      return; // no auth required
    }
    // No bypass for /api/auth/set once an IdP is active: that used to
    // fall through unauthenticated (principalFor() defaults to "open",
    // which isOwnerPrincipal() treats as owner), so anyone could set the
    // first password and take over the instance before the real owner
    // ever logged in. The legacy no-auth bootstrap above already covers
    // "there's nobody else to protect the vault from yet"; once an IdP
    // is configured that's no longer true, so setting the first password
    // requires an owner session obtained by logging in through it first.
    const isProtected =
      path.startsWith("/api/") || path === "/mcp" || path.startsWith("/mcp/");
    if (!isProtected) return;
    if (OPEN_PATHS.has(path)) return;
    if (OPEN_PREFIXES.some((p) => path.startsWith(p))) return;
    const tok = bearer(request);

    // V53: session token from POST /api/auth/login (web UI). This is the
    // one credential that proves the caller knows the owner's password,
    // it bypasses per-folder MCP permissions everywhere.
    if (tokens.validate(tok)) {
      principals.set(request, { kind: "owner" });
      const identity = tokens.identityFor(tok);
      if (identity) {
        identityContext.enterWith(
          identity.name && identity.email
            ? externalIdentity(identity.sub, identity.name, identity.email)
            : localIdentity(owner.name, owner.email, identity.sub),
        );
      }
      return;
    }

    // V66: long-lived named API key (Settings → Security → API Keys).
    // Works on EVERY protected path (both /api/* and /mcp/*) so a single
    // key can drive the HTTP API and the MCP transport from the same
    // Claude Desktop / curl config. Treated as an agent credential: full
    // read/write scope, but subject to per-folder MCP permissions.
    if (keys) {
      const rec = keys.validate(tok);
      if (rec) {
        principals.set(request, { kind: "apikey" });
        identityContext.enterWith(apiKeyIdentity(rec.sub, rec.name, rec.id));
        return;
      }
    }

    // V63: OAuth access token — audience-bound to this MCP resource.
    // Only valid for /mcp paths; /api/* stays session-or-API-key. Subject
    // to both its own granted scope and per-folder MCP permissions.
    if (oauth && tok && (path === "/mcp" || path.startsWith("/mcp/"))) {
      const resource = `${originOf(request)}/mcp`;
      const v = oauth.validateAccess(tok, resource);
      if (v.ok) {
        const scopes = v.scope.split(/\s+/).filter(Boolean);
        const read = scopes.includes("vault:read");
        const write = scopes.includes("vault:write");
        if (read || write) {
          principals.set(request, { kind: "oauth", read, write });
          const clientName = oauthClients?.get(v.clientId)?.client_name ?? v.clientId;
          identityContext.enterWith(oauthClientIdentity(v.sub, clientName, v.clientId));
          return;
        }
      }
    }

    set.status = 401;
    const resourceMetadata = `${originOf(request)}/.well-known/oauth-protected-resource`;
    return new Response(
      JSON.stringify({ error: "unauthorized", code: "AUTH_REQUIRED" }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": `Bearer resource_metadata="${resourceMetadata}", scope="vault:read vault:write"`,
        },
      },
    );
  });
}
