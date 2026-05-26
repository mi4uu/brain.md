export interface GitCommit {
  sha: string;
  subject: string;
  ts: number;
  author: string;
}

export interface GitStatus {
  enabled: boolean;
  head: string | null;
  branch: string | null;
  dirty: boolean;
  lastCommit: GitCommit | null;
  autocommit: { enabled: boolean; debounceMs: number };
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
