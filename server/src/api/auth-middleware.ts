import { Elysia } from "elysia";
import type { AuthStore } from "../auth/store";
import type { TokenStore } from "../auth/tokens";

// V53: protect every /api/* (except /api/auth/{status,login}) + /mcp/*
// once auth.json exists. When unconfigured, the middleware is a no-op so
// fresh installs work without setup.

const OPEN_PATHS = new Set(["/api/auth/status", "/api/auth/login"]);

function bearer(req: Request): string | undefined {
  const a = req.headers.get("authorization");
  if (!a) return undefined;
  const m = /^Bearer\s+(.+)$/.exec(a);
  return m ? m[1] : undefined;
}

export function authMiddleware(auth: AuthStore, tokens: TokenStore) {
  return new Elysia().onRequest(({ request, set }) => {
    if (!auth.isConfigured()) return; // no auth required
    const url = new URL(request.url);
    const path = url.pathname;
    const isProtected = path.startsWith("/api/") || path.startsWith("/mcp/");
    if (!isProtected) return;
    if (OPEN_PATHS.has(path)) return;
    const tok = bearer(request);
    if (!tokens.validate(tok)) {
      set.status = 401;
      // Return body directly here — Elysia respects this.
      return new Response(
        JSON.stringify({ error: "unauthorized", code: "AUTH_REQUIRED" }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );
    }
    return;
  });
}
