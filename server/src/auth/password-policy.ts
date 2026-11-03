import type { AuthStore } from "./store";
import type { LoginConfig } from "./login-config";
import type { LoginLimiter } from "./login-limiter";
import { verifyPassword } from "./hasher";

// Shared between POST /api/auth/login (the web UI) and the MCP consent
// page's password field (api/oauth-flow.ts): both are "prove you know the
// owner's password", so both must respect the same policy. Before this,
// the consent page ran its own bare Bun.password.verify call, bypassing
// both loginConfig.passwordLogin (a BRAINMD_PASSWORD_LOGIN=off deployment
// still accepted a password there) and the brute-force limiter (an IP
// locked out of /api/auth/login could keep guessing through /oauth/authorize).

export type PasswordCheckResult =
  | { ok: true }
  | { ok: false; reason: "disabled" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "invalid" };

export async function checkOwnerPassword(opts: {
  password: string;
  authStore: AuthStore;
  loginConfig: LoginConfig;
  loginLimiter: LoginLimiter;
  ip: string;
}): Promise<PasswordCheckResult> {
  const { password, authStore, loginConfig, loginLimiter, ip } = opts;

  const gate = loginLimiter.check(ip);
  if (!gate.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: gate.retryAfterSeconds ?? 1 };
  }
  await loginLimiter.globalBackoff();

  if (!loginConfig.passwordLogin) {
    return { ok: false, reason: "disabled" };
  }
  if (!authStore.isConfigured()) {
    return { ok: false, reason: "not_configured" };
  }
  const ok = await verifyPassword(password, authStore.getHash() ?? "");
  if (!ok) {
    loginLimiter.recordFailure(ip);
    return { ok: false, reason: "invalid" };
  }
  loginLimiter.recordSuccess(ip);
  return { ok: true };
}
