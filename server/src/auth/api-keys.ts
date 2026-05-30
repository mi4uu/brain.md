import { randomBytes } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";

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

const REL = ".brain/api-keys.json";
const DEBOUNCE_MS = 200;

export interface APIKey {
  id: string;                 // 8-hex public identifier (shown in UI + URL)
  token: string;              // 32-byte base64url — only returned once
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;   // null = never expires
}

export interface PublicAPIKey {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  prefix: string;             // first 8 chars of token, for "match it to your config"
}

interface PersistedFile {
  version: 1;
  keys: APIKey[];
}

export class APIKeyStore {
  private readonly byToken = new Map<string, APIKey>();
  private readonly byId = new Map<string, APIKey>();
  private vault?: Vault;
  private dirty = false;
  private flushTimer?: ReturnType<typeof setTimeout>;

  async bindVault(vault: Vault): Promise<void> {
    this.vault = vault;
    await this.load();
  }

  private async load(): Promise<void> {
    if (!this.vault) return;
    try {
      const raw = await readFile(this.vault.abs(REL), "utf8");
      const parsed = JSON.parse(raw) as PersistedFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.keys)) return;
      for (const k of parsed.keys) {
        if (typeof k.token !== "string" || typeof k.id !== "string") continue;
        this.byToken.set(k.token, k);
        this.byId.set(k.id, k);
      }
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

  private async flush(): Promise<void> {
    if (!this.vault) return;
    this.dirty = false;
    const data: PersistedFile = {
      version: 1,
      keys: Array.from(this.byToken.values()),
    };
    const abs = this.vault.abs(REL);
    try {
      await mkdir(dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp`;
      await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
      await rename(tmp, abs);
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
    const key: APIKey = {
      id,
      token,
      name: args.name.slice(0, 200) || "Unnamed key",
      createdAt: now,
      lastUsedAt: null,
      expiresAt,
    };
    this.byToken.set(token, key);
    this.byId.set(id, key);
    this.scheduleFlush();
    return key;
  }

  validate(token: string | undefined): APIKey | null {
    if (!token) return null;
    const key = this.byToken.get(token);
    if (!key) return null;
    if (key.expiresAt !== null && key.expiresAt < Date.now()) {
      // Lazy GC of expired keys.
      this.byToken.delete(token);
      this.byId.delete(key.id);
      this.scheduleFlush();
      return null;
    }
    key.lastUsedAt = Date.now();
    this.scheduleFlush();
    return key;
  }

  revoke(id: string): boolean {
    const key = this.byId.get(id);
    if (!key) return false;
    this.byToken.delete(key.token);
    this.byId.delete(id);
    this.scheduleFlush();
    return true;
  }

  list(): PublicAPIKey[] {
    return Array.from(this.byToken.values()).map((k) => ({
      id: k.id,
      name: k.name,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
      prefix: k.token.slice(0, 8),
    }));
  }

  count(): number {
    return this.byToken.size;
  }
}
