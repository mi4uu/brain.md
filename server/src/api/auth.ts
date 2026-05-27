import { Elysia, t } from "elysia";
import type { AuthStore } from "../auth/store";
import type { TokenStore } from "../auth/tokens";
import { hashPassword, verifyPassword } from "../auth/hasher";

// V53: auth routes.
// - GET  /api/auth/status        always open
// - POST /api/auth/login         always open
// - POST /api/auth/set           open when ! configured (initial setup);
//                                requires currentPassword once configured
// - POST /api/auth/clear         requires currentPassword
// - POST /api/auth/logout        requires the token in the body
//
// The middleware (auth-middleware.ts) handles bearer enforcement on
// everything else.

function bearer(headers: Record<string, string | undefined>): string | undefined {
  const a = headers.authorization ?? headers.Authorization;
  if (!a) return undefined;
  const m = /^Bearer\s+(.+)$/.exec(a);
  return m ? m[1] : undefined;
}

export function authRoutes(auth: AuthStore, tokens: TokenStore) {
  return new Elysia()
    .get("/api/auth/status", ({ request }) => {
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      const tok = bearer(headers);
      return {
        configured: auth.isConfigured(),
        authenticated: auth.isConfigured() ? tokens.validate(tok) : true,
      };
    })
    .post(
      "/api/auth/set",
      async ({ body, set }) => {
        const { newPassword, currentPassword } = body;
        if (typeof newPassword !== "string" || newPassword.length < 4) {
          set.status = 400;
          return { error: "newPassword must be ≥ 4 chars" };
        }
        if (auth.isConfigured()) {
          const ok =
            typeof currentPassword === "string" &&
            (await verifyPassword(currentPassword, auth.getHash() ?? ""));
          if (!ok) {
            set.status = 401;
            return { error: "currentPassword incorrect" };
          }
        }
        const hash = await hashPassword(newPassword);
        await auth.save(hash);
        tokens.revokeAll();
        return { ok: true };
      },
      {
        body: t.Object({
          newPassword: t.String(),
          currentPassword: t.Optional(t.String()),
        }),
      },
    )
    .post(
      "/api/auth/clear",
      async ({ body, set }) => {
        if (!auth.isConfigured()) {
          return { ok: true };
        }
        const ok = await verifyPassword(body.currentPassword, auth.getHash() ?? "");
        if (!ok) {
          set.status = 401;
          return { error: "currentPassword incorrect" };
        }
        await auth.clear();
        tokens.revokeAll();
        return { ok: true };
      },
      { body: t.Object({ currentPassword: t.String() }) },
    )
    .post(
      "/api/auth/login",
      async ({ body, set }) => {
        if (!auth.isConfigured()) {
          set.status = 409;
          return { error: "auth not configured" };
        }
        const ok = await verifyPassword(body.password, auth.getHash() ?? "");
        if (!ok) {
          set.status = 401;
          return { error: "invalid password" };
        }
        const { token, expiresAt } = tokens.issue();
        return { token, expiresAt };
      },
      { body: t.Object({ password: t.String() }) },
    )
    .post(
      "/api/auth/logout",
      ({ body }) => {
        tokens.revoke(body.token);
        return { ok: true };
      },
      { body: t.Object({ token: t.String() }) },
    );
}
