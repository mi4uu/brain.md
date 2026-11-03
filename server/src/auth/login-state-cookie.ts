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

const COOKIE_NAME = "brainmd_idp_flow";
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
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearFlowCookie(secure: boolean): string {
  const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readFlowCookie(cookieHeader: string | null): LoginFlowState | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== COOKIE_NAME) continue;
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
const BIND_COOKIE_NAME = "brainmd_idp_bind";
const BIND_MAX_AGE_SECONDS = 120;

export function serializeBindCookie(secret: string, secure: boolean): string {
  const parts = [
    `${BIND_COOKIE_NAME}=${secret}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${BIND_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearBindCookie(secure: boolean): string {
  const parts = [`${BIND_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readBindCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name !== BIND_COOKIE_NAME) continue;
    const raw = part.slice(eq + 1).trim();
    return raw.length > 0 ? raw : undefined;
  }
  return undefined;
}
