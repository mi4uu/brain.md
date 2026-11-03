import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";
import { LOCAL_SUB } from "./identity";

// V53 + B19: session bearer token table. 24h TTL. Persists to
// <vault>/.brain/tokens.json so a server restart doesn't invalidate
// every active client. Previously in-memory only, which led to the
// security anti-feature where users hard-coded the password as the
// "token" because nothing else survived a restart — combined with the
// pre-v0.4 middleware bug that exempted POST /mcp from auth checks,
// the vault was effectively public on any v0.3.x deployment with
// auth.json present.
//
// Writes are debounced 200ms so login bursts don't hammer disk.
//
// Only the SHA-256 hash of a token is ever persisted or kept as a map
// key, never the plaintext. Lookups hash the incoming bearer value and
// compare with timingSafeEqual so a token can't be recovered by timing
// a byte-by-byte guess. Files predating this change stored plaintext
// tokens under a "token" field; load() migrates those in place.

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const REL = ".brain/tokens.json";
const DEBOUNCE_MS = 200;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface TokenRecord {
  expiresAt: number;
  sub: string;
}

interface PersistedFile {
  version: 1;
  tokens: Array<{ tokenHash: string; expiresAt: number; sub: string }>;
}

// Pre-migration on-disk shape (plaintext token, and/or no `sub`: identity
// plumbing postdates this file, so every record before it is "local").
interface LegacyPersistedFile {
  version: 1;
  tokens: Array<{ token?: string; tokenHash?: string; expiresAt: number; sub?: string }>;
}

export class TokenStore {
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly ttlMs: number;
  private vault?: Vault;
  private dirty = false;
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  // B19: bind a vault for persistence. Optional — leaving unbound keeps
  // the original in-memory-only behaviour (useful for tests / CI).
  async bindVault(vault: Vault): Promise<void> {
    this.vault = vault;
    await this.load();
  }

  private async load(): Promise<void> {
    if (!this.vault) return;
    try {
      const raw = await readFile(this.vault.abs(REL), "utf8");
      const parsed = JSON.parse(raw) as LegacyPersistedFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.tokens)) return;
      const now = Date.now();
      let migrated = false;
      for (const t of parsed.tokens) {
        if (typeof t.expiresAt !== "number" || t.expiresAt <= now) continue;
        const sub = typeof t.sub === "string" && t.sub.length > 0 ? t.sub : LOCAL_SUB;
        if (sub !== t.sub) migrated = true;
        if (typeof t.tokenHash === "string") {
          this.tokens.set(t.tokenHash, { expiresAt: t.expiresAt, sub });
        } else if (typeof t.token === "string") {
          // Pre-hash format: migrate to a hash-only record on next flush.
          this.tokens.set(hashToken(t.token), { expiresAt: t.expiresAt, sub });
          migrated = true;
        }
      }
      if (migrated) this.scheduleFlush();
    } catch {
      // No file or malformed JSON — start empty.
    }
  }

  private scheduleFlush(): void {
    if (!this.vault) return;
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (this.dirty) void this.flush();
    }, DEBOUNCE_MS);
    this.flushTimer.unref?.();
  }

  private async flush(): Promise<void> {
    if (!this.vault) return;
    this.dirty = false;
    const data: PersistedFile = {
      version: 1,
      tokens: Array.from(this.tokens.entries()).map(([tokenHash, rec]) => ({
        tokenHash,
        expiresAt: rec.expiresAt,
        sub: rec.sub,
      })),
    };
    const abs = this.vault.abs(REL);
    try {
      await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
      const tmp = `${abs}.tmp`;
      await writeFile(tmp, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
      await rename(tmp, abs);
    } catch (e) {
      // Best-effort persistence — keep serving even if disk write fails.
      // eslint-disable-next-line no-console
      console.warn(
        "[auth] failed to persist tokens.json:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  issue(sub: string = LOCAL_SUB): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + this.ttlMs;
    this.tokens.set(hashToken(token), { expiresAt, sub });
    this.scheduleFlush();
    return { token, expiresAt };
  }

  validate(token: string | undefined): boolean {
    return this.lookup(token) !== undefined;
  }

  // Identity resolution (auth-middleware.ts): the subject behind a valid
  // session token, without the caller re-deriving the expiry/hash logic
  // that validate() already does.
  subFor(token: string | undefined): string | undefined {
    return this.lookup(token)?.sub;
  }

  private lookup(token: string | undefined): TokenRecord | undefined {
    if (!token) return undefined;
    const hash = hashToken(token);
    const rec = this.tokens.get(hash);
    if (!rec) return undefined;
    if (rec.expiresAt < Date.now()) {
      this.tokens.delete(hash);
      this.scheduleFlush();
      return undefined;
    }
    return rec;
  }

  revoke(token: string | undefined): boolean {
    if (!token) return false;
    const had = this.tokens.delete(hashToken(token));
    if (had) this.scheduleFlush();
    return had;
  }

  revokeAll(): void {
    if (this.tokens.size === 0) return;
    this.tokens.clear();
    this.scheduleFlush();
  }

  // For tests
  size(): number {
    return this.tokens.size;
  }
}
