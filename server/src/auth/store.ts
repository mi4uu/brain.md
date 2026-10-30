import { mkdir, readFile, rename, unlink, writeFile, stat, unlink as fsUnlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";

// V53: persistent password hash at <VAULT>/.brain/auth.json.
// Schema: { hash: string, createdAt: number, updatedAt: number }
// When the file is absent → auth is OPTIONAL (every endpoint open).

const REL = ".brain/auth.json";

interface AuthFile {
  hash: string;
  createdAt: number;
  updatedAt: number;
}

export class AuthStore {
  private data?: AuthFile;
  private loaded = false;
  // Fail-closed latch: set when auth.json exists but could not be read or
  // parsed. While true, isConfigured() reports true and getHash() returns
  // undefined, so every password check fails instead of auth silently
  // becoming optional.
  private corrupt = false;

  constructor(private readonly vault: Vault) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.vault.abs(REL), "utf8");
      let parsed: Partial<AuthFile>;
      try {
        parsed = JSON.parse(raw) as Partial<AuthFile>;
      } catch (e) {
        console.error(`[auth] ${REL} is not valid JSON; failing closed:`, e);
        this.corrupt = true;
        this.loaded = true;
        return;
      }
      if (parsed && typeof parsed.hash === "string" && parsed.hash.length > 0) {
        this.data = {
          hash: parsed.hash,
          createdAt: Number(parsed.createdAt) || Date.now(),
          updatedAt: Number(parsed.updatedAt) || Date.now(),
        };
      } else {
        console.error(`[auth] ${REL} is missing a valid "hash" field; failing closed`);
        this.corrupt = true;
      }
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== "ENOENT") {
        // File exists but couldn't be read (permissions, I/O error, …).
        // Only a genuinely absent file means "first run, auth unconfigured".
        console.error(`[auth] failed to read ${REL}; failing closed:`, e);
        this.corrupt = true;
      }
      // ENOENT → file absent → unconfigured, nothing to log.
    }
    this.loaded = true;
  }

  isConfigured(): boolean {
    return this.data !== undefined || this.corrupt;
  }

  getHash(): string | undefined {
    return this.data?.hash;
  }

  async save(hash: string): Promise<void> {
    const now = Date.now();
    const next: AuthFile = {
      hash,
      createdAt: this.data?.createdAt ?? now,
      updatedAt: now,
    };
    await this.persist(next);
    this.data = next;
    this.corrupt = false;
  }

  async clear(): Promise<void> {
    const abs = this.vault.abs(REL);
    try {
      await fsUnlink(abs);
    } catch {
      // already gone
    }
    this.data = undefined;
    this.corrupt = false;
  }

  private async persist(data: AuthFile): Promise<void> {
    const abs = this.vault.abs(REL);
    await mkdir(dirname(abs), { recursive: true, mode: 0o700 });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
      await rename(tmp, abs);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }

  // For diagnostic / tests
  async fileExists(): Promise<boolean> {
    try {
      await stat(this.vault.abs(REL));
      return true;
    } catch {
      return false;
    }
  }
}
