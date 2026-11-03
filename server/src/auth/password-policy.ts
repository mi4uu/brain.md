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

// Caps how many argon2id verifications (hasher.ts: ~19MiB, real CPU time
// each) run at once across every caller. The rate limiter already bounds
// concurrent attempts per IP to MAX_FAILURES, but a burst spread across
// many IPs could still pin the event loop; this bounds it server-wide.
const MAX_CONCURRENT_VERIFICATIONS = 4;
let activeVerifications = 0;
const verificationQueue: Array<() => void> = [];

async function withVerificationSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeVerifications >= MAX_CONCURRENT_VERIFICATIONS) {
    await new Promise<void>((resolve) => verificationQueue.push(resolve));
  }
  activeVerifications++;
  try {
    return await fn();
  } finally {
    activeVerifications--;
    verificationQueue.shift()?.();
  }
}

export async function checkOwnerPassword(opts: {
  password: string;
  authStore: AuthStore;
  loginConfig: LoginConfig;
  loginLimiter: LoginLimiter;
  ip: string;
}): Promise<PasswordCheckResult> {
  const { password, authStore, loginConfig, loginLimiter, ip } = opts;

  // Reserve the attempt synchronously, before any await, so concurrent
  // callers from the same IP can't all pass the gate and all get
  // verified before any of them records a failure. See LoginLimiter.reserve.
  const reservation = loginLimiter.reserve(ip);
  if (!reservation.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: reservation.retryAfterSeconds ?? 1 };
  }
  try {
    await loginLimiter.globalBackoff();

    if (!loginConfig.passwordLogin) {
      return { ok: false, reason: "disabled" };
    }
    if (!authStore.isConfigured()) {
      return { ok: false, reason: "not_configured" };
    }
    const ok = await withVerificationSlot(() => verifyPassword(password, authStore.getHash() ?? ""));
    if (!ok) {
      loginLimiter.recordFailure(ip);
      return { ok: false, reason: "invalid" };
    }
    loginLimiter.recordSuccess(ip);
    return { ok: true };
  } finally {
    reservation.release();
  }
}
