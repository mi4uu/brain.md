import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface GitCommit {
  sha: string;
  subject: string;
  ts: number;
  author: string;
  authorEmail: string;
  // From the commit's Agent trailer: set for changes made by an API key or
  // MCP client (autocommit.ts), empty for people.
  agent: string;
}

export interface GitStatus {
  enabled: boolean;
  head: string | null;
  branch: string | null;
  dirty: boolean;
  lastCommit: GitCommit | null;
}

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";
export type ActorKind = "human" | "agent" | "unattributed";

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  actor: string;
  actorKind: ActorKind;
}

export interface ChangeCommit {
  sha: string;
  ts: number;
  author: string;
  files: ChangedFile[];
}

const GITIGNORE = [
  ".brain/",
  "node_modules/",
  ".DS_Store",
  "Thumbs.db",
  "*.tmp-*",
  "",
].join("\n");

async function run(
  cwd: string,
  args: string[],
  opts: { input?: string; allowFail?: boolean; env?: Record<string, string> } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdin: opts.input !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      // log/diff/show/restore all take a caller-supplied path as a
      // pathspec. Without this, a path like "*.md" that passed the
      // per-path permission check (it resolves to the root folder's own
      // perms) is interpreted by git as a glob matching every top-level
      // note, letting restore/diff touch or disclose files the caller was
      // never authorised for. Equivalent to prefixing every pathspec with
      // ":(literal)".
      GIT_LITERAL_PATHSPECS: "1",
      ...opts.env,
    },
  });
  if (opts.input !== undefined && proc.stdin) {
    proc.stdin.write(opts.input);
    await proc.stdin.end();
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0 && !opts.allowFail) {
    throw new Error(
      `git ${args.join(" ")} exit ${code}: ${stderr.trim() || stdout.trim()}`,
    );
  }
  return { code, stdout, stderr };
}

// A commit's author/trailer metadata. `trailers` is a list, not a map, so
// the same key (e.g. "Changed-by") can appear once per path instead of
// collapsing to its last value.
export interface CommitTrailer {
  key: string;
  value: string;
}

export class GitRepo {
  // Every git-touching operation below (reads included) runs through this
  // one queue. Design note: an earlier version split writes into a
  // per-actor isolated index (GIT_INDEX_FILE) plus a "reconcile the real
  // index afterwards" step, so that status()/dirtyPaths() reads could run
  // concurrently with a commit. That bought concurrency at the cost of two
  // real bugs: reads (`git status`) and the reconcile step both touch
  // .git/index, so they could contend for .git/index.lock with an
  // in-progress commit; and splitting one flush into several commits (one
  // per actor) meant one actor's failed/retrying commit could race
  // another's. Serializing reads too removes the lock contention outright,
  // and committing once per flush (autocommit.ts) removes the multi-commit
  // race, at the cost of making a `git status` wait for an in-flight
  // commit. That's the right trade here: this repo is written to in bursts
  // separated by a debounce, not under sustained concurrent load.
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(public readonly root: string) {}

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  async ensure(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const gitDir = join(this.root, ".git");
    if (!existsSync(gitDir)) {
      await run(this.root, ["init", "--quiet", "--initial-branch=main"]);
      await this.ensureGitignore();
      await run(this.root, ["config", "user.email", "brain@local"]);
      await run(this.root, ["config", "user.name", "brain.md"]);
      await run(this.root, ["config", "commit.gpgsign", "false"]);
      await this.commitAll("initial");
    } else {
      await this.ensureGitignore();
      await run(this.root, ["config", "user.email", "brain@local"], { allowFail: true });
      await run(this.root, ["config", "user.name", "brain.md"], { allowFail: true });
    }
  }

  private async ensureGitignore(): Promise<void> {
    const path = join(this.root, ".gitignore");
    const exists = existsSync(path);
    if (!exists) {
      await writeFile(path, GITIGNORE);
      return;
    }
    const cur = await Bun.file(path).text();
    if (!cur.includes(".brain/")) {
      await writeFile(path, cur.endsWith("\n") ? cur + GITIGNORE : cur + "\n" + GITIGNORE);
    }
  }

  async isEnabled(): Promise<boolean> {
    return existsSync(join(this.root, ".git"));
  }

  // Serialized with every commit/restore below: `git status` without
  // --no-optional-locks refreshes and can rewrite .git/index as a side
  // effect, which contends for .git/index.lock with an in-progress
  // `commit`/`checkout` exactly like a second writer would. Running it
  // through the same queue means a status read during a commit simply
  // waits its turn instead of racing for the lock.
  async hasChanges(): Promise<boolean> {
    return this.serialize(async () => {
      const r = await run(this.root, ["--no-optional-locks", "status", "--porcelain"], { allowFail: true });
      return r.code === 0 && r.stdout.trim() !== "";
    });
  }

  // Current working-tree paths with any dirty status (staged, unstaged,
  // or untracked). Used by autocommit.ts to work out which dirty paths
  // belong to no notified actor at all, instead of a blanket `git add -A`
  // that can't tell those apart from paths already queued for their own
  // attributed commit. `-z` avoids porcelain's path quoting; a rename or
  // copy record carries an extra NUL-terminated original-path field we
  // don't need, so it's skipped.
  // `--untracked-files=all`: without it, git collapses a wholly-untracked
  // directory into one line for the directory itself ("new folder/"),
  // which can't be compared against pendingPaths at all (that holds
  // concrete file paths like "new folder/b.md") and gets treated as
  // unclaimed in its entirety, sweeping in whatever a notified actor just
  // put there. Listing every file individually makes the exact-path
  // exclusion in autocommit.ts actually work.
  // Same serialization reasoning as hasChanges() above.
  async dirtyPaths(): Promise<string[]> {
    return this.serialize(async () => {
      const r = await run(
        this.root,
        ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        { allowFail: true },
      );
      if (r.code !== 0) return [];
      const tokens = r.stdout.split("\0").filter((t) => t.length > 0);
      const paths: string[] = [];
      for (let i = 0; i < tokens.length; i++) {
        const entry = tokens[i] ?? "";
        const code = entry.slice(0, 2);
        paths.push(entry.slice(3));
        if (code.includes("R") || code.includes("C")) i++; // skip the orig-path field
      }
      return paths;
    });
  }

  async stageAll(): Promise<void> {
    await run(this.root, ["add", "-A", "--", "."]);
  }

  // Of the given pathspecs, keeps only the ones git can stage: tracked
  // (so a deletion still gets staged even though the file is gone from
  // disk) or present on disk (a new or modified file). `ls-files` never
  // errors on an unmatched pathspec, it just omits it, unlike `add`.
  private async filterStageable(paths: string[]): Promise<string[]> {
    const [idx, head] = await Promise.all([
      run(this.root, ["ls-files", "-z", "--", ...paths], { allowFail: true }),
      run(this.root, ["ls-tree", "-z", "-r", "--name-only", "HEAD", "--", ...paths], { allowFail: true }),
    ]);
    const tracked = new Set([
      ...idx.stdout.split("\0").filter(Boolean),
      ...head.stdout.split("\0").filter(Boolean),
    ]);
    return paths.filter((p) => tracked.has(p) || existsSync(join(this.root, p)));
  }

  // `paths`: stage only these (pathspecs), instead of everything under
  // the tree. `author`: --author override; committer config
  // (brain.md/brain@local) never changes, only who the change is
  // attributed to. `trailers`: appended as plain "Key: value" lines after
  // a blank line, same convention `git interpret-trailers` reads, without
  // requiring it; a list, not a map, so the same key can repeat (one
  // "Changed-by" line per path, see autocommit.ts).
  //
  // Design note: this always stages and commits straight into the repo's
  // real index, one commit per call, serialized against every other
  // repo operation via `serialize()`. An earlier version split each
  // flush into one commit per actor through a private, temporary index
  // (GIT_INDEX_FILE) plus a step to reconcile the real index afterwards,
  // to let actors commit "concurrently" without stepping on each other's
  // staged content. That bought nothing autocommit.ts still needed once
  // it was changed to make one combined commit per flush (see
  // autocommit.ts's module comment): with only one commitAll in flight at
  // a time per flush, there is no other actor's staged content to step
  // on, and the serialize() queue already means no two commitAll/restore
  // calls run concurrently at all.
  commitAll(
    message: string,
    opts: {
      paths?: string[];
      author?: { name: string; email: string };
      trailers?: CommitTrailer[];
    } = {},
  ): Promise<string | null> {
    return this.serialize(async () => {
      if (opts.paths && opts.paths.length > 0) {
        const candidates = await this.filterStageable(opts.paths);
        if (candidates.length === 0) return null;
        await run(this.root, ["add", "-A", "--", ...candidates]);
      } else {
        await this.stageAll();
      }
      return this.commitStaged(message, opts);
    });
  }

  // Builds `fullMessage`/`args` for the commit.
  private buildCommitArgs(
    message: string,
    opts: { author?: { name: string; email: string }; trailers?: CommitTrailer[] },
  ): string[] {
    const trailerLines = (opts.trailers ?? []).map(
      (t) => `${sanitizeAuthorPart(t.key)}: ${sanitizeAuthorPart(t.value)}`,
    );
    const fullMessage = trailerLines.length > 0 ? `${message}\n\n${trailerLines.join("\n")}` : message;
    const args = ["commit", "--quiet", "--allow-empty-message", "-m", fullMessage];
    if (opts.author) {
      args.push("--author", `${sanitizeAuthorPart(opts.author.name)} <${sanitizeAuthorPart(opts.author.email)}>`);
    }
    return args;
  }

  // Commits whatever is currently staged in the real index. On a rejected
  // commit (a hook, disk full, a lock held by another process), the
  // paths this call itself staged above are unstaged again so a later,
  // unrelated commitAll call never inherits them.
  private async commitStaged(
    message: string,
    opts: { author?: { name: string; email: string }; trailers?: CommitTrailer[] },
  ): Promise<string | null> {
    const args = this.buildCommitArgs(message, opts);
    const r = await run(this.root, args, { allowFail: true });
    if (r.code !== 0) {
      if (r.stdout.includes("nothing to commit") || r.stderr.includes("nothing to commit")) {
        return null;
      }
      await run(this.root, ["reset"], { allowFail: true });
      throw new Error(r.stderr || r.stdout);
    }
    return this.headSha();
  }

  async headSha(): Promise<string | null> {
    const r = await run(this.root, ["rev-parse", "HEAD"], { allowFail: true });
    if (r.code !== 0) return null;
    return r.stdout.trim() || null;
  }

  async branch(): Promise<string | null> {
    const r = await run(this.root, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true });
    if (r.code !== 0) return null;
    return r.stdout.trim() || null;
  }

  async lastCommit(): Promise<GitCommit | null> {
    const r = await run(
      this.root,
      ["log", "-1", "--pretty=format:%H%x1f%s%x1f%ct%x1f%an"],
      { allowFail: true },
    );
    if (r.code !== 0 || !r.stdout.trim()) return null;
    return parseCommit(r.stdout.trim());
  }

  async status(): Promise<GitStatus> {
    const enabled = await this.isEnabled();
    if (!enabled) {
      return { enabled: false, head: null, branch: null, dirty: false, lastCommit: null };
    }
    const [head, branch, dirty, last] = await Promise.all([
      this.headSha(),
      this.branch(),
      this.hasChanges(),
      this.lastCommit(),
    ]);
    return { enabled, head, branch, dirty, lastCommit: last };
  }

  async log(opts: { path?: string; limit?: number } = {}): Promise<GitCommit[]> {
    const args = [
      "log",
      `-${opts.limit ?? 50}`,
      "--pretty=format:%H%x1f%s%x1f%ct%x1f%an%x1f%ae%x1f%(trailers:key=Agent,valueonly,separator=%x2C)",
    ];
    if (opts.path) {
      args.push("--follow", "--", opts.path);
    }
    const r = await run(this.root, args, { allowFail: true });
    if (r.code !== 0 || !r.stdout.trim()) return [];
    return r.stdout
      .split("\n")
      .filter((l) => l.trim() !== "")
      .map(parseCommit);
  }

  async show(sha: string, path: string): Promise<string> {
    assertSha(sha);
    const r = await run(this.root, ["show", `${sha}:${path}`]);
    return r.stdout;
  }

  async diff(sha: string, path: string): Promise<string> {
    assertSha(sha);
    const r = await run(this.root, ["diff", sha, "--", path], { allowFail: true });
    return r.stdout;
  }

  // Vault-wide history with the paths each commit touched and who touched
  // each one. Autocommit records one actor per commit in an Agent trailer,
  // or, when a flush mixed actors, one "Changed-by: <path> <actor>" trailer
  // per path with the human owner as author. -z keeps paths with spaces and
  // non-ASCII characters unquoted.
  async changes(opts: { limit?: number; before?: string } = {}): Promise<ChangeCommit[]> {
    if (opts.before) assertSha(opts.before);
    const args = [
      "log",
      "-z",
      "--name-status",
      "-M",
      `-${opts.limit ?? 200}`,
      "--pretty=format:%x02%H%x1f%ct%x1f%an%x1f%ae%x1f%(trailers:key=Agent,valueonly,separator=%x1e)%x1f%(trailers:key=Changed-by,valueonly,separator=%x1e)",
    ];
    if (opts.before) args.push(`${opts.before}^`);
    const r = await run(this.root, args, { allowFail: true });
    if (r.code !== 0 || !r.stdout) return [];
    return parseChanges(r.stdout);
  }

  // The patch a commit made to one path, against its parent (a root commit
  // shows the whole file as added). Unlike diff(), which compares a version
  // with the working tree.
  async commitPatch(sha: string, path: string, oldPath?: string): Promise<string> {
    assertSha(sha);
    const paths = oldPath && oldPath !== path ? [oldPath, path] : [path];
    const r = await run(this.root, ["show", "-M", "--format=", "--patch", sha, "--", ...paths], {
      allowFail: true,
    });
    return r.stdout;
  }

  async existsAt(sha: string, path: string): Promise<boolean> {
    assertSha(sha);
    const r = await run(this.root, ["cat-file", "-e", `${sha}:${path}`], { allowFail: true });
    return r.code === 0;
  }

  async parentOf(sha: string): Promise<string | null> {
    assertSha(sha);
    const r = await run(this.root, ["rev-parse", "--verify", "--quiet", `${sha}^`], { allowFail: true });
    return r.code === 0 ? r.stdout.trim() || null : null;
  }

  // Undo one commit's change to one path while keeping later edits: apply
  // that commit's patch for the path in reverse to the working tree. Throws
  // PatchConflictError when later edits overlap and the patch no longer fits.
  async revertPatch(sha: string, path: string): Promise<void> {
    assertSha(sha);
    await this.serialize(async () => {
      const patch = await run(this.root, ["show", "--format=", "--binary", "--no-renames", sha, "--", path]);
      if (!patch.stdout.trim()) throw new Error(`commit ${sha.slice(0, 7)} did not change ${path}`);
      // -C1: a later edit right next to this change (an append after an
      // agent's append) still lets it be undone. The lines being removed or
      // restored must match exactly either way.
      const check = await run(this.root, ["apply", "-R", "-C1", "--check", "-"], {
        input: patch.stdout,
        allowFail: true,
      });
      if (check.code !== 0) throw new PatchConflictError(path, check.stderr.trim());
      await run(this.root, ["apply", "-R", "-C1", "-"], { input: patch.stdout });
    });
  }

  // Audit P0: a `git checkout <sha> -- <path>` where `path` names a tree
  // (a directory) at that sha, not a blob, restores every file under it
  // recursively instead of the single file the caller asked for and
  // assertMarkdown()'s ".md" suffix check implied. Checking the object
  // type first, before checkout ever runs, rejects that instead of
  // silently recursing.
  async restore(path: string, sha: string): Promise<void> {
    assertSha(sha);
    await this.serialize(async () => {
      const typeCheck = await run(this.root, ["cat-file", "-t", `${sha}:${path}`], { allowFail: true });
      if (typeCheck.code === 0 && typeCheck.stdout.trim() === "tree") {
        throw new Error(`refusing to restore ${path}: it is a directory at ${sha}, not a file`);
      }
      await run(this.root, ["checkout", sha, "--", path]);
    });
  }

  async tag(name: string, message: string): Promise<void> {
    if (!/^[A-Za-z0-9_./-]+$/.test(name)) {
      throw new Error("invalid tag name");
    }
    await run(this.root, ["tag", "-a", name, "-m", message]);
  }
}

function parseCommit(line: string): GitCommit {
  const parts = line.split("\x1f");
  return {
    sha: parts[0] ?? "",
    subject: parts[1] ?? "",
    ts: Number(parts[2] ?? "0") * 1000,
    author: parts[3] ?? "",
    authorEmail: parts[4] ?? "",
    agent: (parts[5] ?? "").trim(),
  };
}

// --author takes one argv string ("Name <email>"); strip newlines and the
// angle brackets a hostile key/client name could use to inject a second
// "<email>" pair, rather than relying on git to reject a malformed value.
// Also used to sanitise trailer keys/values: a trailer line is just text
// in the commit message, so a name containing "\nSigned-off-by: x" would
// otherwise inject a second, forged trailer line verbatim.
function sanitizeAuthorPart(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  return s.replace(/[\x00-\x1f\x7f<>]/g, " ").trim();
}

function assertSha(sha: string): void {
  if (!/^[a-f0-9]{4,64}$/i.test(sha)) {
    throw new Error("invalid sha");
  }
}

export class PatchConflictError extends Error {
  constructor(
    public readonly path: string,
    detail: string,
  ) {
    super(`later edits to ${path} overlap this change, so it cannot be undone on its own${detail ? ` (${detail})` : ""}`);
    this.name = "PatchConflictError";
  }
}

const STATUS: Record<string, ChangeStatus> = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "added", T: "modified" };

export function parseChanges(out: string): ChangeCommit[] {
  const commits: ChangeCommit[] = [];
  for (const chunk of out.split("\x02")) {
    if (!chunk) continue;
    const nl = chunk.indexOf("\n");
    const header = nl === -1 ? chunk : chunk.slice(0, nl);
    const body = nl === -1 ? "" : chunk.slice(nl + 1);
    const [sha = "", ct = "0", author = "", , agentRaw = "", changedByRaw = ""] = header.split("\x1f");
    const agent = agentRaw.split("\x1e").map((a) => a.trim()).filter(Boolean)[0] ?? "";
    const changedBy = changedByRaw.split("\x1e").map((v) => v.trim()).filter(Boolean);
    const tokens = body.split("\0").filter((t) => t !== "");
    const files: ChangedFile[] = [];
    for (let i = 0; i < tokens.length; ) {
      const code = tokens[i++]!;
      const status = STATUS[code[0] ?? ""] ?? "modified";
      let oldPath: string | undefined;
      if (code[0] === "R" || code[0] === "C") oldPath = tokens[i++];
      const path = tokens[i++];
      if (!path || path.startsWith(".brain/") || path === ".gitignore") continue;
      const { actor, actorKind } = actorFor(path, author, agent, changedBy);
      files.push({ path, ...(code[0] === "R" && oldPath ? { oldPath } : {}), status, actor, actorKind });
    }
    if (files.length > 0) commits.push({ sha, ts: Number(ct) * 1000, author, files });
  }
  return commits;
}

// The fallback committer autocommit uses when nobody claimed a path (an
// edit straight on disk, or a restart that lost the pending set).
const UNATTRIBUTED_AUTHOR = "brain.md";

function actorFor(
  path: string,
  author: string,
  agent: string,
  changedBy: string[],
): { actor: string; actorKind: ActorKind } {
  const entry = changedBy.find((v) => v.startsWith(`${path} `));
  if (entry) {
    const actor = entry.slice(path.length + 1).trim();
    if (actor === UNATTRIBUTED_AUTHOR) return { actor, actorKind: "unattributed" };
    return { actor, actorKind: actor === author ? "human" : "agent" };
  }
  if (agent) return { actor: agent, actorKind: "agent" };
  if (author === UNATTRIBUTED_AUTHOR) return { actor: author, actorKind: "unattributed" };
  return { actor: author, actorKind: "human" };
}
