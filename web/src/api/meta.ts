export interface FolderMeta {
  version: 1;
  icons: Record<string, string>;
  colors: Record<string, string>;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const metaApi = {
  async get(): Promise<FolderMeta> {
    return jsonOrThrow<FolderMeta>(await fetch("/api/folder-meta"));
  },
  async set(path: string, icon: string | null, color?: string | null): Promise<{ ok: true; meta: FolderMeta }> {
    return jsonOrThrow<{ ok: true; meta: FolderMeta }>(
      await fetch("/api/folder-meta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, icon, color }),
      }),
    );
  },
};
