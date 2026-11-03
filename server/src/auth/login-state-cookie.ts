// Board-plan Part B: the short-lived cookie that carries an external
// login flow's state/PKCE verifier/nonce from GET .../start to
// GET .../callback. HttpOnly so page scripts never see it, Secure +
// SameSite=Lax so it only ever comes back on the top-level navigation
// the provider redirects the browser through.
//
// Not signed: it never leaves the browser that received it, and its only
// job is "does this callback belong to the flow we started", which the
// state/nonce comparison already covers. Tampering with your own cookie
// only breaks your own login attempt.

// __Host- locks the cookie to this exact host: no Domain attribute, no
// looser-scoped sibling (a compromised or malicious subdomain) can set a
// cookie by this name that our own Path=/, same-host code would then
// read back as if it were ours, reopening the login CSRF the bind
// cookie exists to close. The prefix requires Secure, which the
// unencrypted localhost dev server never has, so plain names are the
// explicit, dev-only fallback: never used once `secure` is true.
const COOKIE_NAME_SECURE = "__Host-brainmd_idp_flow";
const COOKIE_NAME_DEV = "brainmd_idp_flow_dev";
const MAX_AGE_SECONDS = 600; // 10 min, generous for a redirect round trip

export interface LoginFlowState {
  provider: string;
  state: string;
  verifier: string;
  nonce?: string; // OIDC only
  // Random per-flow secret, carried through to the bind cookie set on a
  // successful callback (serializeBindCookie below). Binds the handoff
  // code to the browser that actually ran the flow, see idp-auth.ts.
  bind: string;
  expiresAt: number;
}

export function serializeFlowCookie(flow: LoginFlowState, secure: boolean): string {
  const value = Buffer.from(JSON.stringify(flow), "utf8").toString("base64url");
  const parts = [
    `${secure ? COOKIE_NAME_SECURE : COOKIE_NAME_DEV}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearFlowCookie(secure: boolean): string {
  const parts = [`${secure ? COOKIE_NAME_SECURE : COOKIE_NAME_DEV}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readFlowCookie(cookieHeader: string | null, secure: boolean): LoginFlowState | undefined {
  if (!cookieHeader) return undefined;
  const name = secure ? COOKIE_NAME_SECURE : COOKIE_NAME_DEV;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const cookieName = part.slice(0, eq).trim();
    if (cookieName !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      const flow = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as LoginFlowState;
      if (flow.expiresAt < Date.now()) return undefined;
      return flow;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// Set on a successful callback, cleared once /api/auth/idp/exchange
// consumes it. Carries the flow's `bind` secret past the point where the
// flow cookie itself is cleared (it's single-use regardless of outcome),
// so the browser that ran the flow, and only that browser, can redeem
// the handoff code the callback redirected it to. Without this, the
// handoff code alone is enough: an attacker who runs their own login and
// hands the resulting URL to a victim gets the victim's browser to adopt
// the attacker's session (login CSRF), the code itself proves nothing
// about which browser is presenting it.
const BIND_COOKIE_NAME_SECURE = "__Host-brainmd_idp_bind";
const BIND_COOKIE_NAME_DEV = "brainmd_idp_bind_dev";
const BIND_MAX_AGE_SECONDS = 120;

export function serializeBindCookie(secret: string, secure: boolean): string {
  const parts = [
    `${secure ? BIND_COOKIE_NAME_SECURE : BIND_COOKIE_NAME_DEV}=${secret}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${BIND_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearBindCookie(secure: boolean): string {
  const parts = [
    `${secure ? BIND_COOKIE_NAME_SECURE : BIND_COOKIE_NAME_DEV}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readBindCookie(cookieHeader: string | null, secure: boolean): string | undefined {
  if (!cookieHeader) return undefined;
  const name = secure ? BIND_COOKIE_NAME_SECURE : BIND_COOKIE_NAME_DEV;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const cookieName = part.slice(0, eq).trim();
    if (cookieName !== name) continue;
    const raw = part.slice(eq + 1).trim();
    return raw.length > 0 ? raw : undefined;
  }
  return undefined;
}
