import { randomBytes, createHash } from "node:crypto";
import { readFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";
import { atomicWrite } from "../vault/atomic-write";
import { LOCAL_SUB } from "./identity";

// V66: long-lived named API keys. Survive restarts (persist to
// <vault>/.brain/api-keys.json), have human-readable labels for
// audit, can be revoked individually. Sit alongside the V53 session
// token store and the V63 OAuth access tokens — any of the three
// validates a bearer on /mcp.
//
// Use case: MCP clients (Claude Code's claude_desktop_config.json,
// curl scripts, cron-driven agents) that need a stable Authorization
// header. Generated once in Settings → Security → API Keys, revoked
// individually if leaked.
//
// Only the SHA-256 hash of a key is ever persisted; the plaintext is
// returned to the caller once, at creation, and never stored. A short
// unhashed prefix is kept so the UI can show "which key is this" without
// revealing the rest. Files predating this change stored the plaintext
// token; load() migrates those in place.

const REL = ".brain/api-keys.json";
const DEBOUNCE_MS = 200;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface APIKey {
  id: string;                 // 8-hex public identifier (shown in UI + URL)
  token: string;              // 32-byte base64url — only returned once
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;   // null = never expires
  sub: string;                 // identity subject for git attribution, see auth/identity.ts
}

export interface PublicAPIKey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  prefix: string;             // first 8 chars of token, for "match it to your config"
}

// Stored, hashed record, never holds the plaintext token.
interface StoredAPIKey {
  id: string;
  tokenHash: string;
  prefix: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  sub: string;
}

interface PersistedFile {
  version: 1;
  keys: StoredAPIKey[];
}

// Pre-migration on-disk shape (plaintext token, no hash/prefix/sub).
interface LegacyStoredAPIKey extends Partial<StoredAPIKey> {
  token?: string;
}
interface LegacyPersistedFile {
  version: 1;
  keys: LegacyStoredAPIKey[];
}

export class APIKeyStore {
  private readonly byHash = new Map<string, StoredAPIKey>();
  private readonly byId = new Map<string, StoredAPIKey>();
  private vault?: Vault;
  private dirty = false;
  private flushTimer?: ReturnType<typeof setTimeout>;
  // Chains flush() calls so a flush scheduled while a previous one is
  // still writing waits for its rename to finish before starting its own,
  // instead of racing another in-flight write to the same destination.
  private flushChain: Promise<void> = Promise.resolve();

  async bindVault(vault: Vault): Promise<void> {
    this.vault = vault;
    await this.load();
  }

  private async load(): Promise<void> {
    if (!this.vault) return;
    try {
      const raw = await readFile(this.vault.abs(REL), "utf8");
      const parsed = JSON.parse(raw) as LegacyPersistedFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.keys)) return;
      let migrated = false;
      for (const k of parsed.keys) {
        if (typeof k.id !== "string") continue;
        let rec: StoredAPIKey;
        if (typeof k.tokenHash === "string" && typeof k.prefix === "string") {
          const sub = typeof k.sub === "string" && k.sub.length > 0 ? k.sub : LOCAL_SUB;
          if (sub !== k.sub) migrated = true;
          rec = {
            id: k.id,
            tokenHash: k.tokenHash,
            prefix: k.prefix,
            name: k.name ?? "Unnamed key",
            createdAt: k.createdAt ?? Date.now(),
            lastUsedAt: k.lastUsedAt ?? null,
            expiresAt: k.expiresAt ?? null,
            sub,
          };
        } else if (typeof k.token === "string") {
          // Pre-hash format: migrate to a hash-only record on next flush.
          // No sub predates this format either, same "local" default.
          rec = {
            id: k.id,
            tokenHash: hashToken(k.token),
            prefix: k.token.slice(0, 8),
            name: k.name ?? "Unnamed key",
            createdAt: k.createdAt ?? Date.now(),
            lastUsedAt: k.lastUsedAt ?? null,
            expiresAt: k.expiresAt ?? null,
            sub: LOCAL_SUB,
          };
          migrated = true;
        } else {
          continue;
        }
        this.byHash.set(rec.tokenHash, rec);
        this.byId.set(rec.id, rec);
      }
      if (migrated) this.scheduleFlush();
    } catch {
      // No file or malformed — start empty.
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

  private flush(): Promise<void> {
    const next = this.flushChain.then(() => this.doFlush());
    this.flushChain = next;
    return next;
  }

  private async doFlush(): Promise<void> {
    if (!this.vault) return;
    this.dirty = false;
    const data: PersistedFile = {
      version: 1,
      keys: Array.from(this.byHash.values()),
    };
    const abs = this.vault.abs(REL);
    try {
      await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
      await atomicWrite(abs, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        "[auth] failed to persist api-keys.json:",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  create(args: { name: string; expiresInDays?: number | null }): APIKey {
    const id = randomBytes(4).toString("hex");
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const expiresAt =
      args.expiresInDays && args.expiresInDays > 0
        ? now + args.expiresInDays * 24 * 60 * 60 * 1000
        : null;
    const name = args.name.slice(0, 200) || "Unnamed key";
    // Each new key gets its own stable subject, unlike migrated legacy keys
    // (which default to "local", they were never distinguishable from the
    // owner before this field existed).
    const sub = `apikey:${id}`;
    const rec: StoredAPIKey = {
      id,
      tokenHash: hashToken(token),
      prefix: token.slice(0, 8),
      name,
      createdAt: now,
      lastUsedAt: null,
      expiresAt,
      sub,
    };
    this.byHash.set(rec.tokenHash, rec);
    this.byId.set(id, rec);
    this.scheduleFlush();
    // Plaintext token only ever leaves the store here, at creation time.
    return { id, token, name, createdAt: now, lastUsedAt: null, expiresAt, sub };
  }

  validate(token: string | undefined): APIKey | null {
    if (!token) return null;
    const hash = hashToken(token);
    const rec = this.byHash.get(hash);
    if (!rec) return null;
    if (rec.expiresAt !== null && rec.expiresAt < Date.now()) {
      // Lazy GC of expired keys.
      this.byHash.delete(hash);
      this.byId.delete(rec.id);
      this.scheduleFlush();
      return null;
    }
    rec.lastUsedAt = Date.now();
    this.scheduleFlush();
    return { ...rec, token };
  }

  revoke(id: string): boolean {
    const rec = this.byId.get(id);
    if (!rec) return false;
    this.byHash.delete(rec.tokenHash);
    this.byId.delete(id);
    this.scheduleFlush();
    return true;
  }

  list(): PublicAPIKey[] {
    return Array.from(this.byHash.values()).map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      prefix: k.prefix,
    }));
  }

  count(): number {
    return this.byHash.size;
  }
}
