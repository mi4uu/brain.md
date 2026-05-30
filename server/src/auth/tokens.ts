import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";

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

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const REL = ".brain/tokens.json";
const DEBOUNCE_MS = 200;

interface TokenRecord {
  expiresAt: number;
}

interface PersistedFile {
  version: 1;
  tokens: Array<{ token: string; expiresAt: number }>;
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
      const parsed = JSON.parse(raw) as PersistedFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.tokens)) return;
      const now = Date.now();
      for (const t of parsed.tokens) {
        if (typeof t.token === "string" && typeof t.expiresAt === "number" && t.expiresAt > now) {
          this.tokens.set(t.token, { expiresAt: t.expiresAt });
        }
      }
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
      tokens: Array.from(this.tokens.entries()).map(([token, rec]) => ({
        token,
        expiresAt: rec.expiresAt,
      })),
    };
    const abs = this.vault.abs(REL);
    try {
      await mkdir(dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp`;
      await writeFile(tmp, JSON.stringify(data), "utf8");
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

  issue(): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + this.ttlMs;
    this.tokens.set(token, { expiresAt });
    this.scheduleFlush();
    return { token, expiresAt };
  }

  validate(token: string | undefined): boolean {
    if (!token) return false;
    const rec = this.tokens.get(token);
    if (!rec) return false;
    if (rec.expiresAt < Date.now()) {
      this.tokens.delete(token);
      this.scheduleFlush();
      return false;
    }
    return true;
  }

  revoke(token: string | undefined): boolean {
    if (!token) return false;
    const had = this.tokens.delete(token);
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
