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

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const settingsApi = {
  async get(): Promise<AppSettings> {
    return jsonOrThrow<AppSettings>(await fetch("/api/settings"));
  },
  async patch(p: SettingsPatch): Promise<AppSettings> {
    return jsonOrThrow<AppSettings>(
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      }),
    );
  },
};
