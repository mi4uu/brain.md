import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";

export interface GitSettings {
  autocommit: boolean;
  debounceMs: number;
}

export interface AppSettings {
  version: 1;
  bookmarks: string[];
  dailyDir: string;
  git: GitSettings;
}

export interface SettingsPatch {
  bookmarks?: string[];
  dailyDir?: string;
  git?: Partial<GitSettings>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  bookmarks: [],
  dailyDir: "Journal",
  git: { autocommit: true, debounceMs: 15000 },
};

const REL = ".brain/settings.json";

export class SettingsStore {
  private data: AppSettings = DEFAULT_SETTINGS;
  private loaded = false;

  constructor(private readonly vault: Vault) {}

  get(): AppSettings {
    return this.data;
  }

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.vault.abs(REL), "utf8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      this.data = mergeWithDefaults(parsed);
    } catch {
      this.data = { ...DEFAULT_SETTINGS };
    }
    this.loaded = true;
    return this.data;
  }

  async patch(partial: SettingsPatch): Promise<AppSettings> {
    if (!this.loaded) await this.load();
    const next: AppSettings = {
      version: 1,
      bookmarks: partial.bookmarks ?? this.data.bookmarks,
      dailyDir: partial.dailyDir ?? this.data.dailyDir,
      git: {
        autocommit: partial.git?.autocommit ?? this.data.git.autocommit,
        debounceMs: partial.git?.debounceMs ?? this.data.git.debounceMs,
      },
    };
    this.data = next;
    await this.persist();
    return this.data;
  }

  private async persist(): Promise<void> {
    const abs = this.vault.abs(REL);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    try {
      await rename(tmp, abs);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }
}

function mergeWithDefaults(p: Partial<AppSettings>): AppSettings {
  return {
    version: 1,
    bookmarks: Array.isArray(p.bookmarks) ? p.bookmarks.filter((b) => typeof b === "string") : [],
    dailyDir: typeof p.dailyDir === "string" ? p.dailyDir : DEFAULT_SETTINGS.dailyDir,
    git: {
      autocommit:
        typeof p.git?.autocommit === "boolean" ? p.git.autocommit : DEFAULT_SETTINGS.git.autocommit,
      debounceMs:
        typeof p.git?.debounceMs === "number"
          ? Math.max(500, p.git.debounceMs)
          : DEFAULT_SETTINGS.git.debounceMs,
    },
  };
}
