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

  constructor(private readonly vault: Vault) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.vault.abs(REL), "utf8");
      const parsed = JSON.parse(raw) as Partial<AuthFile>;
      if (parsed && typeof parsed.hash === "string" && parsed.hash.length > 0) {
        this.data = {
          hash: parsed.hash,
          createdAt: Number(parsed.createdAt) || Date.now(),
          updatedAt: Number(parsed.updatedAt) || Date.now(),
        };
      }
    } catch {
      // file absent → unconfigured
    }
    this.loaded = true;
  }

  isConfigured(): boolean {
    return this.data !== undefined;
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
  }

  async clear(): Promise<void> {
    const abs = this.vault.abs(REL);
    try {
      await fsUnlink(abs);
    } catch {
      // already gone
    }
    this.data = undefined;
  }

  private async persist(data: AuthFile): Promise<void> {
    const abs = this.vault.abs(REL);
    await mkdir(dirname(abs), { recursive: true });
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
