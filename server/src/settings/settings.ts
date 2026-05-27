import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";
import { DEFAULT_RAG_CONFIG, type RagConfig } from "../rag/types";

export interface GitSettings {
  autocommit: boolean;
  debounceMs: number;
}

export interface AppSettings {
  version: 1;
  bookmarks: string[];
  dailyDir: string;
  git: GitSettings;
  rag: RagConfig;
}

export interface SettingsPatch {
  bookmarks?: string[];
  dailyDir?: string;
  git?: Partial<GitSettings>;
  rag?: Partial<RagConfig>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  bookmarks: [],
  dailyDir: "Journal",
  git: { autocommit: true, debounceMs: 15000 },
  rag: DEFAULT_RAG_CONFIG,
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
      rag: mergeRag(this.data.rag, partial.rag),
    };
    this.data = next;
    await this.persist();
    return this.data;
  }

  private async persist(): Promise<void> {
    const abs = this.vault.abs(REL);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    // Never persist the apiKey to disk in plaintext if someone wants it
    // env-only — for v1 we DO persist (vault is single-user; auth.json
    // gates remote access). Document in V49 if revisited.
    await writeFile(tmp, JSON.stringify(this.data, null, 2));
    try {
      await rename(tmp, abs);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }
}

function mergeRag(cur: RagConfig, patch?: Partial<RagConfig>): RagConfig {
  if (!patch) return cur;
  return {
    enabled: typeof patch.enabled === "boolean" ? patch.enabled : cur.enabled,
    provider:
      patch.provider === "local" || patch.provider === "openai-compat"
        ? patch.provider
        : cur.provider,
    local: {
      model:
        typeof patch.local?.model === "string" ? patch.local.model : cur.local.model,
      dim:
        typeof patch.local?.dim === "number" && patch.local.dim > 0
          ? patch.local.dim
          : cur.local.dim,
    },
    openaiCompat: {
      baseURL:
        typeof patch.openaiCompat?.baseURL === "string"
          ? patch.openaiCompat.baseURL
          : cur.openaiCompat.baseURL,
      model:
        typeof patch.openaiCompat?.model === "string"
          ? patch.openaiCompat.model
          : cur.openaiCompat.model,
      apiKey:
        typeof patch.openaiCompat?.apiKey === "string"
          ? patch.openaiCompat.apiKey
          : cur.openaiCompat.apiKey,
      dim:
        typeof patch.openaiCompat?.dim === "number" && patch.openaiCompat.dim > 0
          ? patch.openaiCompat.dim
          : cur.openaiCompat.dim,
    },
  };
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
    rag: mergeRag(DEFAULT_RAG_CONFIG, p.rag),
  };
}
