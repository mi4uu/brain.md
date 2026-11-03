import { Elysia, t } from "elysia";
import type { AuthStore } from "../auth/store";
import type { TokenStore } from "../auth/tokens";
import type { LoginLimiter } from "../auth/login-limiter";
import type { LoginConfig } from "../auth/login-config";
import { hashPassword, verifyPassword } from "../auth/hasher";
import { requireOwner } from "./perm-guard";
import { getClientIp } from "./client-ip";

// V53: auth routes.
// - GET  /api/auth/status        always open
// - POST /api/auth/login         always open
// - POST /api/auth/set           open when ! configured (initial setup);
//                                requires currentPassword once configured
// - POST /api/auth/clear         requires currentPassword
// - POST /api/auth/logout        requires the token in the body
//
// /login is rate limited by auth/login-limiter.ts (per-IP sliding window +
// a small global backoff) before the password is ever checked.
//
// The middleware (auth-middleware.ts) handles bearer enforcement on
// everything else.

function bearer(headers: Record<string, string | undefined>): string | undefined {
  const a = headers.authorization ?? headers.Authorization;
  if (!a) return undefined;
  const m = /^Bearer\s+(.+)$/.exec(a);
  return m ? m[1] : undefined;
}

export function authRoutes(
  auth: AuthStore,
  tokens: TokenStore,
  loginLimiter: LoginLimiter,
  loginConfig: LoginConfig,
) {
  return new Elysia()
    // board-plan Part B: tells the login page which methods to render,
    // before anyone is authenticated. Deliberately leaves out issuer
    // URLs, client IDs, allowlists, a provider name and its button
    // label are all the UI needs.
    .get("/api/auth/config", () => ({
      password: loginConfig.passwordLogin,
      providers: [
        ...(loginConfig.oidc ? [{ id: "oidc", label: loginConfig.oidc.name }] : []),
        ...(loginConfig.github ? [{ id: "github", label: "GitHub" }] : []),
      ],
    }))
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
      async ({ body, set, request }) => {
        try {
          requireOwner(request);
        } catch {
          set.status = 403;
          return { error: "owner session required" };
        }
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
      async ({ body, set, request }) => {
        try {
          requireOwner(request);
        } catch {
          set.status = 403;
          return { error: "owner session required" };
        }
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
      async ({ body, set, request, server }) => {
        const ip = getClientIp(request, server);
        const gate = loginLimiter.check(ip);
        if (!gate.allowed) {
          set.status = 429;
          set.headers["retry-after"] = String(gate.retryAfterSeconds);
          return { error: "too many failed attempts, try again later", code: "RATE_LIMITED" };
        }
        await loginLimiter.globalBackoff();

        if (!loginConfig.passwordLogin) {
          set.status = 403;
          return { error: "password login is disabled", code: "PASSWORD_LOGIN_DISABLED" };
        }
        if (!auth.isConfigured()) {
          set.status = 409;
          return { error: "auth not configured" };
        }
        const ok = await verifyPassword(body.password, auth.getHash() ?? "");
        if (!ok) {
          loginLimiter.recordFailure(ip);
          set.status = 401;
          return { error: "invalid password" };
        }
        loginLimiter.recordSuccess(ip);
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
