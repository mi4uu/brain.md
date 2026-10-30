import type {
  Backlink,
  MediaUploadResult,
  NoteData,
  RenameResult,
  ResolveResult,
  SearchHit,
  TreeData,
  WriteNoteResult,
} from "./types";

const BASE = "";

// Thrown by writeNote on a 409 from the server: someone else (another tab,
// an MCP client) saved the note since we last read/wrote it. `revision` is
// the server's current revision, for a follow-up reload or forced write.
export class ConflictError extends Error {
  revision: string;
  constructor(revision: string) {
    super("note changed on disk since last save");
    this.name = "ConflictError";
    this.revision = revision;
  }
}

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
  async writeNote(path: string, content: string, baseRevision?: string): Promise<WriteNoteResult> {
    const res = await fetch(`${BASE}/api/note/${encodePath(path)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(baseRevision === undefined ? { content } : { content, baseRevision }),
    });
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}) as Record<string, unknown>);
      throw new ConflictError(typeof body.revision === "string" ? body.revision : "");
    }
    return jsonOrThrow(res);
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
  // V54: returns 503 + {code:"RAG_DISABLED"} when RAG is off — caller should
  // swallow and render an empty state instead of treating it as fatal.
  async related(
    path: string,
    k = 5,
  ): Promise<
    | { ok: true; hits: RelatedHit[] }
    | { ok: false; code: "RAG_DISABLED" | "RAG_ERROR"; error: string }
  > {
    const res = await fetch(
      `${BASE}/api/related/${encodePath(path)}?k=${k}`,
    );
    if (res.ok) return { ok: true, hits: (await res.json()) as RelatedHit[] };
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      code: body.code ?? "RAG_ERROR",
      error: body.error ?? `${res.status}`,
    };
  },
};

export interface RelatedHit {
  path: string;
  chunkIndex: number;
  score: number;
  snippet: string;
  headingTrail: string[];
  lineStart: number;
  lineEnd: number;
}
