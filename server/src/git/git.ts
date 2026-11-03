import { existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

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

export class GitRepo {
  private writeChain: Promise<unknown> = Promise.resolve();
  // Paths whose real-index reconcile failed after a successful commit
  // (see reconcileRealIndex). Retried opportunistically at the start of
  // the next isolated-index commit, any actor's, instead of left stale
  // forever.
  private unreconciled = new Set<string>();

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

  async hasChanges(): Promise<boolean> {
    const r = await run(this.root, ["status", "--porcelain"], { allowFail: true });
    return r.code === 0 && r.stdout.trim() !== "";
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
  async dirtyPaths(): Promise<string[]> {
    const r = await run(
      this.root,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
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
  }

  async stageAll(): Promise<void> {
    await run(this.root, ["add", "-A", "--", "."]);
  }

  // Of the given pathspecs, keeps only the ones git can stage: tracked
  // (so a deletion still gets staged even though the file is gone from
  // disk) or present on disk (a new or modified file). `ls-files` never
  // errors on an unmatched pathspec, it just omits it, unlike `add`.
  //
  // Should-fix: "tracked" used to mean only "in the real index". The real
  // index is reconciled after each isolated-index commit (see
  // commitWithIsolatedIndex) and that reconcile can itself fail (a
  // post-commit hook holding index.lock) and leave the real index stale,
  // still missing a path HEAD already has. A later deletion of that same
  // path then looked untracked AND absent from disk, so it was dropped
  // from `candidates` entirely and never staged: the delete silently
  // never made it into any commit. Checking HEAD's tree too, not only the
  // real index, makes that call correct regardless of real-index
  // staleness, since commitWithIsolatedIndex always rebuilds its working
  // index from HEAD anyway.
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
  // the tree. Used to split one flush window into one commit per actor
  // (board-plan Part B) without sweeping another actor's still-pending
  // changes into this commit.
  // `author`: --author override; committer config (brain.md/brain@local)
  // never changes, only who the change is attributed to.
  // `trailers`: appended as plain "Key: value" lines after a blank line,
  // same convention `git interpret-trailers` reads, without requiring it.
  // `excludeIfClaimed`: rechecked twice inside commitWithIsolatedIndex,
  // immediately before `git add` and again immediately before `git
  // commit` (each itself an async git call, so a notify() can still land
  // in the gap after either check): a path it says yes to at either point
  // is dropped before anything irreversible happens to it. Both
  // autocommit's per-actor group commits and its fallback commit pass
  // this to re-test "is this path still mine" right up against the
  // staging and committing calls, closing the gap between choosing the
  // candidate list and acting on it.
  commitAll(
    message: string,
    opts: {
      paths?: string[];
      author?: { name: string; email: string };
      trailers?: Record<string, string>;
      excludeIfClaimed?: (path: string) => boolean;
    } = {},
  ): Promise<string | null> {
    return this.serialize(async () => {
      if (opts.paths && opts.paths.length > 0) {
        return this.commitWithIsolatedIndex(message, opts.paths, opts);
      }
      await this.stageAll();
      return this.commitStaged(message, opts);
    });
  }

  // Builds `fullMessage`/`args` shared by both staging strategies below.
  private buildCommitArgs(
    message: string,
    opts: { author?: { name: string; email: string }; trailers?: Record<string, string> },
  ): string[] {
    const trailerLines = opts.trailers
      ? Object.entries(opts.trailers).map(
          ([k, v]) => `${sanitizeAuthorPart(k)}: ${sanitizeAuthorPart(v)}`,
        )
      : [];
    const fullMessage = trailerLines.length > 0 ? `${message}\n\n${trailerLines.join("\n")}` : message;
    const args = ["commit", "--quiet", "--allow-empty-message", "-m", fullMessage];
    if (opts.author) {
      args.push("--author", `${sanitizeAuthorPart(opts.author.name)} <${sanitizeAuthorPart(opts.author.email)}>`);
    }
    return args;
  }

  // No `paths`: the pre-existing "commit everything staged" behaviour,
  // used only for the init commit (ensure()) and by callers that want a
  // plain whole-repo commit. Operates on the repo's real index directly;
  // not concurrency-sensitive the way the per-actor path is, since it's
  // never called from more than one place at a time in practice.
  private async commitStaged(
    message: string,
    opts: { author?: { name: string; email: string }; trailers?: Record<string, string> },
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

  // Stages and commits `paths` through a private, temporary index file
  // (GIT_INDEX_FILE), never the repo's real one.
  //
  // Must-fix: the old code staged straight into the real index and, on a
  // failed commit (a rejecting hook, disk full, a lock held by another
  // process), ran `git reset -- <paths>` to undo it, un-checked, so a
  // reset that itself failed (e.g. an index.lock left behind by whatever
  // just rejected the commit) silently left those paths staged for
  // whichever commitAll call ran next, crediting them to the wrong actor.
  // It also reset those paths to their HEAD version even when the real
  // index held a *different*, user-staged version of one of them before
  // this call started, destroying it instead of leaving it alone.
  //
  // Building the commit in an isolated index sidesteps both: the real
  // index is never written to while staging or committing, so a failure
  // leaves it exactly as it was, nothing to roll back, and nothing to
  // verify a rollback of. On success, the real index is brought up to
  // date for exactly these paths (the step below real-index staging) so
  // `status()`/`dirtyPaths()` (which read the real index) stop reporting
  // them dirty; anything else already staged there, unrelated to this
  // call, is left untouched.
  private async commitWithIsolatedIndex(
    message: string,
    paths: string[],
    opts: {
      author?: { name: string; email: string };
      trailers?: Record<string, string>;
      excludeIfClaimed?: (path: string) => boolean;
    },
  ): Promise<string | null> {
    if (this.unreconciled.size > 0) {
      const retry = Array.from(this.unreconciled);
      this.unreconciled.clear();
      await this.reconcileRealIndex(retry);
    }
    const [candidates, head] = await Promise.all([this.filterStageable(paths), this.headSha()]);
    if (candidates.length === 0) return null;

    const tmpIndex = join(this.root, ".git", `brainmd-index.${randomBytes(8).toString("hex")}`);
    const tmpEnv = { GIT_INDEX_FILE: tmpIndex };
    try {
      await run(this.root, head ? ["read-tree", head] : ["read-tree", "--empty"], { env: tmpEnv });
      // Must-fix regression (fallback attribution race, not actually
      // closed by the earlier fix): the previous version did this check
      // once, before the read-tree await above, so a notify() landing
      // during that one await was never seen and still got swept into
      // this commit under the wrong author. This is the latest
      // synchronous point before `git add` runs.
      let stageable = opts.excludeIfClaimed ? candidates.filter((p) => !opts.excludeIfClaimed!(p)) : candidates;
      if (stageable.length === 0) return null;
      await run(this.root, ["add", "-A", "--", ...stageable], { env: tmpEnv });
      // `add -A` is itself async, so recheck once more right before the
      // commit that makes it permanent. Anything reclaimed during the add
      // is force-removed from THIS isolated index only: it never touches
      // the real index or the working tree, so there's nothing to undo if
      // the removal itself fails other than retrying the removal.
      if (opts.excludeIfClaimed) {
        const reclaimed = stageable.filter((p) => opts.excludeIfClaimed!(p));
        if (reclaimed.length > 0) {
          await run(this.root, ["update-index", "--force-remove", "--", ...reclaimed], {
            env: tmpEnv,
            allowFail: true,
          });
          stageable = stageable.filter((p) => !reclaimed.includes(p));
          if (stageable.length === 0) return null;
        }
      }
      const args = this.buildCommitArgs(message, opts);
      // Hooks (pre-commit, commit-msg) still fire normally: `git commit`
      // runs them as a subprocess inheriting this env, including
      // GIT_INDEX_FILE, regardless of which index file backs the commit.
      const r = await run(this.root, args, { allowFail: true, env: tmpEnv });
      if (r.code !== 0) {
        if (r.stdout.includes("nothing to commit") || r.stderr.includes("nothing to commit")) {
          return null;
        }
        // Nothing was ever staged in the real index, so there's nothing
        // to roll back: discarding the temp index file below (in
        // `finally`) is the entire cleanup.
        throw new Error(r.stderr || r.stdout);
      }
      const sha = await this.headSha();
      await this.reconcileRealIndex(stageable);
      return sha;
    } finally {
      await rm(tmpIndex, { force: true }).catch(() => undefined);
    }
  }

  // Catches the real index up for exactly `paths`, matching what the
  // isolated-index commit above just committed. Paths outside this call
  // are never touched.
  //
  // Must-fix: the old code did this with a single `git add -A`, fired and
  // forgotten (`allowFail: true`, result ignored). A post-commit hook
  // holding index.lock makes it fail, and nothing noticed: the real index
  // is left stale (still missing a path HEAD now has), which is exactly
  // the staleness filterStageable() has to tolerate above. Retrying a
  // few times, and queuing anything still unreconciled for the next
  // commit to retry, means a transient lock heals itself instead of
  // leaving the real index permanently wrong.
  //
  // Should-fix: `git add -A` also reads the CURRENT working tree, not the
  // tree that was just committed, so an edit landing between the commit
  // above and this call got staged into the real index too, as if it
  // were already committed. Feeding `update-index --index-info` the
  // blob/mode straight from the committed tree reconciles exactly what
  // was committed, regardless of anything written to disk since.
  private async reconcileRealIndex(paths: string[]): Promise<void> {
    const attempt = async () => {
      const r = await run(this.root, ["ls-tree", "-r", "-z", "HEAD", "--", ...paths]);
      const present = new Map<string, string>(); // path -> "<mode> <sha>"
      for (const entry of r.stdout.split("\0").filter(Boolean)) {
        const tab = entry.indexOf("\t");
        if (tab === -1) continue;
        const meta = entry.slice(0, tab).split(" "); // mode type sha
        const path = entry.slice(tab + 1);
        present.set(path, `${meta[0]} ${meta[2]}`);
      }
      const indexInfo = paths
        .filter((p) => present.has(p))
        .map((p) => `${present.get(p)}\t${p}`)
        .join("\n");
      if (indexInfo) {
        await run(this.root, ["update-index", "--index-info"], { input: indexInfo + "\n" });
      }
      const missing = paths.filter((p) => !present.has(p));
      if (missing.length > 0) {
        await run(this.root, ["update-index", "--force-remove", "--", ...missing]);
      }
    };
    for (let i = 0; i < 3; i++) {
      try {
        await attempt();
        return;
      } catch (e) {
        if (i === 2) {
          // Recover rather than block: leave these paths queued so the
          // next isolated-index commit (any actor's) retries reconciling
          // them before doing its own work. The committed history is
          // already correct either way; this only affects what
          // status()/dirtyPaths() report off the real index meanwhile.
          console.warn("[git] failed to reconcile real index after commit, will retry on next commit:", e);
          for (const p of paths) this.unreconciled.add(p);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
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
      "--pretty=format:%H%x1f%s%x1f%ct%x1f%an",
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

  async restore(path: string, sha: string): Promise<void> {
    assertSha(sha);
    await this.serialize(async () => {
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
  };
}

// --author takes one argv string ("Name <email>"); strip newlines and the
// angle brackets a hostile key/client name could use to inject a second
// "<email>" pair, rather than relying on git to reject a malformed value.
// Also used to sanitise trailer keys/values: a trailer line is just text
// in the commit message, so a name containing "\nSigned-off-by: x" would
// otherwise inject a second, forged trailer line verbatim.
function sanitizeAuthorPart(s: string): string {
  return s.replace(/[\x00-\x1f\x7f<>]/g, " ").trim();
}

function assertSha(sha: string): void {
  if (!/^[a-f0-9]{4,64}$/i.test(sha)) {
    throw new Error("invalid sha");
  }
}
