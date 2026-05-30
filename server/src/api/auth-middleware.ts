import { Elysia } from "elysia";
import type { AuthStore } from "../auth/store";
import type { TokenStore } from "../auth/tokens";

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
  const fwdProto = req.headers.get("x-forwarded-proto");
  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdProto && fwdHost) return `${fwdProto}://${fwdHost}`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export function authMiddleware(auth: AuthStore, tokens: TokenStore) {
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
    if (!tokens.validate(tok)) {
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
    }
    return;
  });
}
