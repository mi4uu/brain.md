import { randomBytes, timingSafeEqual } from "node:crypto";

// Board-plan Part B: the callback for an external login provider runs on
// the server (it needs to exchange a code with Google/GitHub/etc. and
// read response bodies), but the actual brain.md session token has to end
// up in the browser's hands, the same way password login's does. Rather
// than putting the real session token in a redirect URL (logs, browser
// history, Referer headers), the callback hands the browser a single-use
// handoff code; the web app immediately exchanges it server-side for the
// real token via POST /api/auth/idp/exchange.
//
// 60s TTL, 32 random bytes, used exactly once. In-memory only: losing one
// on restart just means a login in flight has to be retried.

const TTL_MS = 60_000;
const SWEEP_EVERY = 50;

interface HandoffRecord {
  token: string;
  expiresAt: number;
  // sha256 hex of the per-flow bind secret (login-state-cookie.ts),
  // proving the browser redeeming the code is the one the IdP callback
  // actually redirected. Without this, the code alone is a bearer
  // credential: whoever has the URL gets the session, not whoever the
  // provider authenticated.
  secretHash: string;
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export class HandoffCodeStore {
  private readonly codes = new Map<string, HandoffRecord>();
  private opsSinceSweep = 0;

  issue(token: string, secretHash: string): string {
    this.maybeSweep();
    const code = randomBytes(32).toString("base64url");
    this.codes.set(code, { token, expiresAt: Date.now() + TTL_MS, secretHash });
    return code;
  }

  // Consumes the code if valid: a second call with the same code (replay)
  // returns undefined, same as an unknown, expired, or wrongly-bound one.
  consume(code: string, secretHash: string): string | undefined {
    const rec = this.codes.get(code);
    this.codes.delete(code);
    if (!rec) return undefined;
    if (rec.expiresAt < Date.now()) return undefined;
    if (!constantTimeEq(rec.secretHash, secretHash)) return undefined;
    return rec.token;
  }

  private maybeSweep(): void {
    if (++this.opsSinceSweep < SWEEP_EVERY) return;
    this.opsSinceSweep = 0;
    const now = Date.now();
    for (const [code, rec] of this.codes) {
      if (rec.expiresAt < now) this.codes.delete(code);
    }
  }

  // For tests
  size(): number {
    return this.codes.size;
  }
}
