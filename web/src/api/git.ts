export interface GitCommit {
  sha: string;
  subject: string;
  ts: number;
  author: string;
  authorEmail?: string;
  // Set when an agent (API key or MCP client) made the change.
  agent?: string;
}

export interface GitStatus {
  enabled: boolean;
  head: string | null;
  branch: string | null;
  dirty: boolean;
  lastCommit: GitCommit | null;
  autocommit: { enabled: boolean; debounceMs: number };
}

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";
export type ActorKind = "human" | "agent" | "unattributed";

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  actor: string;
  actorKind: ActorKind;
  hidden?: boolean;
}

export interface ChangeCommit {
  sha: string;
  ts: number;
  author: string;
  files: ChangedFile[];
  afterSeen?: boolean;
}

export interface ChangesPage {
  enabled: boolean;
  seen: { sha: string; ts: number } | null;
  commits: ChangeCommit[];
  hasMore: boolean;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function encPath(p: string): string {
  return p
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

export const gitApi = {
  async changes(opts: { limit?: number; before?: string } = {}): Promise<ChangesPage> {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.before) params.set("before", opts.before);
    return jsonOrThrow<ChangesPage>(await fetch(`/api/git/changes?${params.toString()}`));
  },
  async markSeen(sha: string): Promise<{ sha: string; ts: number }> {
    return jsonOrThrow(
      await fetch("/api/git/changes/seen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha }),
      }),
    );
  },
  async patch(sha: string, path: string, oldPath?: string): Promise<{ patch: string }> {
    const old = oldPath ? `&oldPath=${encPath(oldPath)}` : "";
    return jsonOrThrow<{ patch: string }>(
      await fetch(`/api/git/patch?sha=${encodeURIComponent(sha)}&path=${encPath(path)}${old}`),
    );
  },
  async revert(sha: string, path: string, mode: "patch" | "restore" | "trash"): Promise<{ ok: true; sha: string | null }> {
    const res = await fetch("/api/git/revert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sha, path, mode }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      throw new RevertFailed(body.code ?? String(res.status), body.error ?? res.statusText);
    }
    return res.json() as Promise<{ ok: true; sha: string | null }>;
  },
  // Records pending autocommit edits now, each under whoever made them.
  async flush(): Promise<{ sha: string | null }> {
    return jsonOrThrow(await fetch("/api/git/flush", { method: "POST" }));
  },
  async status(): Promise<GitStatus> {
    return jsonOrThrow<GitStatus>(await fetch("/api/git/status"));
  },
  async log(opts: { path?: string; limit?: number } = {}): Promise<GitCommit[]> {
    const params = new URLSearchParams();
    if (opts.path) params.set("path", opts.path);
    if (opts.limit) params.set("limit", String(opts.limit));
    return jsonOrThrow<GitCommit[]>(await fetch(`/api/git/log?${params.toString()}`));
  },
  async show(sha: string, path: string): Promise<{ content: string }> {
    return jsonOrThrow<{ content: string }>(
      await fetch(`/api/git/show?sha=${encodeURIComponent(sha)}&path=${encPath(path)}`),
    );
  },
  async diff(sha: string, path: string): Promise<{ patch: string }> {
    return jsonOrThrow<{ patch: string }>(
      await fetch(`/api/git/diff?sha=${encodeURIComponent(sha)}&path=${encPath(path)}`),
    );
  },
  async commit(message?: string): Promise<{ sha: string | null }> {
    return jsonOrThrow<{ sha: string | null }>(
      await fetch("/api/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      }),
    );
  },
  async restore(path: string, sha: string): Promise<{ ok: true }> {
    return jsonOrThrow<{ ok: true }>(
      await fetch("/api/git/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, sha }),
      }),
    );
  },
  async checkpoint(message?: string): Promise<{ sha: string | null; tag: string }> {
    return jsonOrThrow<{ sha: string | null; tag: string }>(
      await fetch("/api/git/checkpoint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      }),
    );
  },
  async setAutocommit(opts: { enabled?: boolean; debounceMs?: number }): Promise<{ enabled: boolean; debounceMs: number }> {
    return jsonOrThrow<{ enabled: boolean; debounceMs: number }>(
      await fetch("/api/git/autocommit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(opts),
      }),
    );
  },
};

export class RevertFailed extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
