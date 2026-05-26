import type {
  Backlink,
  MediaUploadResult,
  NoteData,
  RenameResult,
  ResolveResult,
  SearchHit,
  TreeData,
} from "./types";

const BASE = "";

function encodePath(rel: string): string {
  return rel
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  async tree(): Promise<TreeData> {
    return jsonOrThrow(await fetch(`${BASE}/api/tree`));
  },
  async readNote(path: string): Promise<NoteData> {
    return jsonOrThrow(await fetch(`${BASE}/api/note/${encodePath(path)}`));
  },
  async writeNote(path: string, content: string): Promise<{ path: string; mtime: number }> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/note/${encodePath(path)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      }),
    );
  },
  async deleteNote(path: string): Promise<{ ok: true; trashed: string }> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/note/${encodePath(path)}`, { method: "DELETE" }),
    );
  },
  async mkdir(path: string): Promise<{ ok: true }> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/folder/${encodePath(path)}`, { method: "POST" }),
    );
  },
  async deleteFolder(path: string): Promise<{ ok: true; trashed: string }> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/folder/${encodePath(path)}`, { method: "DELETE" }),
    );
  },
  async rename(from: string, to: string): Promise<RenameResult> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from, to }),
      }),
    );
  },
  async search(q: string): Promise<SearchHit[]> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}`),
    );
  },
  async backlinks(path: string): Promise<Backlink[]> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/backlinks/${encodePath(path)}`),
    );
  },
  async resolve(name: string): Promise<ResolveResult> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/resolve?name=${encodeURIComponent(name)}`),
    );
  },
  async uploadMedia(notePath: string, file: File): Promise<MediaUploadResult> {
    const fd = new FormData();
    fd.append("file", file, file.name);
    return jsonOrThrow(
      await fetch(`${BASE}/api/media/${encodePath(notePath)}`, {
        method: "POST",
        body: fd,
      }),
    );
  },
  mediaUrl(path: string): string {
    return `${BASE}/api/media-raw/${encodePath(path)}`;
  },
};
