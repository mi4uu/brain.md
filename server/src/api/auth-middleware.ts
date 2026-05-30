import { Elysia } from "elysia";
import type { AuthStore } from "../auth/store";
import type { TokenStore } from "../auth/tokens";
import type { OAuthStore } from "../auth/oauth-store";

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
  // V64: OAuth discovery endpoints MUST be reachable without a token —
  // the whole point is to let a client learn how to obtain one.
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
]);

const OPEN_PREFIXES = ["/oauth/"]; // /oauth/authorize, /oauth/token, /oauth/register

function bearer(req: Request): string | undefined {
  const a = req.headers.get("authorization");
  if (!a) return undefined;
  const m = /^Bearer\s+(.+)$/.exec(a);
  return m ? m[1] : undefined;
}

function originOf(req: Request): string {
  // Mirror oauth-discovery.originOf — see the long comment there for why.
  // Critical detail: Cloudflare Tunnel does NOT set x-forwarded-proto,
  // it uses cf-visitor instead. Without checking it the audience-bound
  // resource URI we validate against ends up as http://… while the
  // token was issued for https://… → audience mismatch on every call.
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    new URL(req.url).host;
  let proto: string | undefined;
  const cfVisitor = req.headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const v = JSON.parse(cfVisitor) as { scheme?: string };
      if (v.scheme === "http" || v.scheme === "https") proto = v.scheme;
    } catch {
      // ignore malformed
    }
  }
  if (!proto) proto = req.headers.get("x-forwarded-proto") ?? undefined;
  if (!proto) {
    const u = new URL(req.url);
    proto = u.protocol.replace(":", "");
  }
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");
  if (!isLocal && proto === "http") proto = "https";
  return `${proto}://${host}`;
}

export function authMiddleware(auth: AuthStore, tokens: TokenStore, oauth?: OAuthStore) {
  return new Elysia().onRequest(({ request, set }) => {
    if (!auth.isConfigured()) return; // no auth required
    const url = new URL(request.url);
    const path = url.pathname;
    const isProtected =
      path.startsWith("/api/") || path === "/mcp" || path.startsWith("/mcp/");
    if (!isProtected) return;
    if (OPEN_PATHS.has(path)) return;
    if (OPEN_PREFIXES.some((p) => path.startsWith(p))) return;
    const tok = bearer(request);

    // V53: classic password-issued bearer first (web Settings UI uses this).
    if (tokens.validate(tok)) return;

    // V63: fall back to OAuth access token validation when an OAuth store
    // is wired up. Audience-bound: the token must have been issued for the
    // exact MCP resource URI (RFC 8707). For /mcp paths we require an OAuth
    // scope; /api paths stay password-only for now (Settings UI).
    if (oauth && tok && (path === "/mcp" || path.startsWith("/mcp/"))) {
      const resource = `${originOf(request)}/mcp`;
      const v = oauth.validateAccess(tok, resource);
      if (v.ok) {
        const scopes = v.scope.split(/\s+/).filter(Boolean);
        // Minimum scope to touch /mcp at all: at least vault:read.
        if (scopes.includes("vault:read") || scopes.includes("vault:write")) return;
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
