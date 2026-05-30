import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// V63: OAuth 2.1 in-memory state. Lost on restart, same as V53 TokenStore
// (single-user single-device; re-login on resume is acceptable). All
// fields needed to honour the spec for `authorization_code` + `refresh_token`
// grants with PKCE and RFC 8707 audience binding.
//
// Why one store, not three? AuthorizationCode → AccessToken → RefreshToken
// is a linear pipeline; keeping them in one class makes "revoke the whole
// chain on misuse" trivial. Per-record TTLs handle the lifetime differences.

const CODE_TTL_MS = 60_000;                  // 60s — RFC 6749 recommends very short
const ACCESS_TTL_MS = 24 * 60 * 60 * 1000;   // 24h — matches V53 bearer TTL
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7d — long enough for desktop clients

export interface AuthorizationCode {
  code: string;
  clientId: string;
  redirectUri: string;
  scope: string;            // space-separated, e.g. "vault:read vault:write"
  codeChallenge: string;    // RFC 7636 — S256 only (V64 advertises that as sole method)
  codeChallengeMethod: "S256";
  resource: string;         // RFC 8707 audience binding (the MCP server URL)
  expiresAt: number;
  used: boolean;
}

export interface AccessToken {
  token: string;
  clientId: string;
  scope: string;
  resource: string;
  expiresAt: number;
  refreshTokenRef?: string; // back-link for "revoke whole chain"
}

export interface RefreshToken {
  token: string;
  clientId: string;
  scope: string;
  resource: string;
  expiresAt: number;
  accessTokenRef?: string;  // latest access token issued from this refresh
  rotatedFrom?: string;     // previous refresh token (RFC 6749 §10.4 chain)
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;        // seconds
  scope: string;
}

function b64urlSha256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export class OAuthStore {
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly access = new Map<string, AccessToken>();
  private readonly refresh = new Map<string, RefreshToken>();
  private sweepTimer?: ReturnType<typeof setInterval>;

  startSweeper(intervalMs: number = 5 * 60 * 1000): void {
    if (this.sweepTimer) return;
    this.sweepTimer = setInterval(() => this.sweepExpired(), intervalMs);
    // Don't keep the event loop alive just for the sweep.
    this.sweepTimer.unref?.();
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  // ---- authorization_code grant ----

  issueCode(args: {
    clientId: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    codeChallengeMethod: "S256";
    resource: string;
  }): string {
    const code = randomBytes(32).toString("base64url");
    this.codes.set(code, {
      code,
      clientId: args.clientId,
      redirectUri: args.redirectUri,
      scope: args.scope,
      codeChallenge: args.codeChallenge,
      codeChallengeMethod: args.codeChallengeMethod,
      resource: args.resource,
      expiresAt: Date.now() + CODE_TTL_MS,
      used: false,
    });
    return code;
  }

  // Returns the code metadata if valid, NULL otherwise. Marks the code as
  // used regardless of PKCE verification outcome — RFC 6749 §10.5 (replay
  // protection). Callers handle the PKCE check separately.
  consumeCode(
    code: string,
    args: { clientId: string; redirectUri: string; codeVerifier: string; resource: string },
  ):
    | { ok: true; scope: string; resource: string }
    | { ok: false; error: "invalid_grant"; reason: string } {
    const rec = this.codes.get(code);
    if (!rec) return { ok: false, error: "invalid_grant", reason: "unknown code" };
    if (rec.used) {
      // Replay attempt — invalidate any token chain born from this code's clientId.
      // For now we just refuse; chain tracking comes when we add client persistence.
      return { ok: false, error: "invalid_grant", reason: "code already used" };
    }
    rec.used = true;
    if (rec.expiresAt < Date.now()) {
      this.codes.delete(code);
      return { ok: false, error: "invalid_grant", reason: "code expired" };
    }
    if (!constantTimeEq(rec.clientId, args.clientId)) {
      return { ok: false, error: "invalid_grant", reason: "client_id mismatch" };
    }
    if (!constantTimeEq(rec.redirectUri, args.redirectUri)) {
      return { ok: false, error: "invalid_grant", reason: "redirect_uri mismatch" };
    }
    if (!constantTimeEq(rec.resource, args.resource)) {
      return { ok: false, error: "invalid_grant", reason: "resource mismatch" };
    }
    // PKCE verification: S256 only (V64 advertises that as the sole method).
    const challenge = b64urlSha256(args.codeVerifier);
    if (!constantTimeEq(challenge, rec.codeChallenge)) {
      return { ok: false, error: "invalid_grant", reason: "PKCE verification failed" };
    }
    return { ok: true, scope: rec.scope, resource: rec.resource };
  }

  // ---- token issuance ----

  issueTokenPair(args: { clientId: string; scope: string; resource: string }): IssuedTokenPair {
    const access = randomBytes(32).toString("base64url");
    const refresh = randomBytes(32).toString("base64url");
    const now = Date.now();
    this.access.set(access, {
      token: access,
      clientId: args.clientId,
      scope: args.scope,
      resource: args.resource,
      expiresAt: now + ACCESS_TTL_MS,
      refreshTokenRef: refresh,
    });
    this.refresh.set(refresh, {
      token: refresh,
      clientId: args.clientId,
      scope: args.scope,
      resource: args.resource,
      expiresAt: now + REFRESH_TTL_MS,
      accessTokenRef: access,
    });
    return {
      accessToken: access,
      refreshToken: refresh,
      expiresIn: Math.floor(ACCESS_TTL_MS / 1000),
      scope: args.scope,
    };
  }

  // ---- refresh grant (rotation per RFC 6749 §10.4 — public clients) ----

  refreshTokenPair(args: { refreshToken: string; clientId: string }):
    | { ok: true; pair: IssuedTokenPair }
    | { ok: false; error: "invalid_grant"; reason: string } {
    const rec = this.refresh.get(args.refreshToken);
    if (!rec) return { ok: false, error: "invalid_grant", reason: "unknown refresh_token" };
    if (rec.expiresAt < Date.now()) {
      this.refresh.delete(rec.token);
      return { ok: false, error: "invalid_grant", reason: "refresh expired" };
    }
    if (!constantTimeEq(rec.clientId, args.clientId)) {
      return { ok: false, error: "invalid_grant", reason: "client_id mismatch" };
    }
    // Invalidate old refresh + its access companion (rotation).
    this.refresh.delete(rec.token);
    if (rec.accessTokenRef) this.access.delete(rec.accessTokenRef);
    const pair = this.issueTokenPair({
      clientId: rec.clientId,
      scope: rec.scope,
      resource: rec.resource,
    });
    const newRefresh = this.refresh.get(pair.refreshToken);
    if (newRefresh) newRefresh.rotatedFrom = args.refreshToken;
    return { ok: true, pair };
  }

  // ---- validation (called from auth-middleware) ----

  validateAccess(token: string | undefined, resource: string):
    | { ok: true; scope: string }
    | { ok: false; reason: string } {
    if (!token) return { ok: false, reason: "no token" };
    const rec = this.access.get(token);
    if (!rec) return { ok: false, reason: "unknown access token" };
    if (rec.expiresAt < Date.now()) {
      this.access.delete(token);
      return { ok: false, reason: "access expired" };
    }
    // RFC 8707 — audience binding. Reject tokens issued for a different
    // resource. This is what stops the "confused deputy" attack the MCP
    // spec calls out under V63.
    if (!constantTimeEq(rec.resource, resource)) {
      return { ok: false, reason: "audience mismatch" };
    }
    return { ok: true, scope: rec.scope };
  }

  revokeAccess(token: string | undefined): boolean {
    if (!token) return false;
    const rec = this.access.get(token);
    if (!rec) return false;
    this.access.delete(token);
    if (rec.refreshTokenRef) this.refresh.delete(rec.refreshTokenRef);
    return true;
  }

  // ---- maintenance ----

  private sweepExpired(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k);
    for (const [k, v] of this.access) if (v.expiresAt < now) this.access.delete(k);
    for (const [k, v] of this.refresh) if (v.expiresAt < now) this.refresh.delete(k);
  }

  // For tests + admin UI (step 4).
  stats(): { codes: number; access: number; refresh: number } {
    return { codes: this.codes.size, access: this.access.size, refresh: this.refresh.size };
  }
}
