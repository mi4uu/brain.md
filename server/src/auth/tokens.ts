import { randomBytes } from "node:crypto";

// V53: in-memory bearer token table. Lost on restart (intentional — single
// device, login again on resume). 24h TTL. No DB / cookie persistence.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface TokenRecord {
  expiresAt: number;
}

export class TokenStore {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  issue(): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + this.ttlMs;
    this.tokens.set(token, { expiresAt });
    return { token, expiresAt };
  }

  validate(token: string | undefined): boolean {
    if (!token) return false;
    const rec = this.tokens.get(token);
    if (!rec) return false;
    if (rec.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return false;
    }
    return true;
  }

  revoke(token: string | undefined): boolean {
    if (!token) return false;
    return this.tokens.delete(token);
  }

  revokeAll(): void {
    this.tokens.clear();
  }

  // For tests
  size(): number {
    return this.tokens.size;
  }
}
