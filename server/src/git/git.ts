import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
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
  opts: { input?: string; allowFail?: boolean } = {},
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
  async dirtyPaths(): Promise<string[]> {
    const r = await run(this.root, ["status", "--porcelain=v1", "-z"], { allowFail: true });
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
  private async filterStageable(paths: string[]): Promise<string[]> {
    const r = await run(this.root, ["ls-files", "-z", "--", ...paths], { allowFail: true });
    const tracked = new Set(r.stdout.split("\0").filter(Boolean));
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
  commitAll(
    message: string,
    opts: { paths?: string[]; author?: { name: string; email: string }; trailers?: Record<string, string> } = {},
  ): Promise<string | null> {
    return this.serialize(async () => {
      if (opts.paths && opts.paths.length > 0) {
        // A path that's neither tracked nor on disk any more (a
        // transient rename's intermediate name: created and renamed
        // away again before this flush ran) makes `git add` reject the
        // WHOLE pathspec with "did not match any files", staging
        // nothing at all, not just skipping that one path. --ignore-errors
        // doesn't help here, it only covers per-file errors AFTER
        // pathspec matching. Filter to paths git can actually act on
        // first, so the other paths in the same rename chain (the
        // original, now-deleted name; the final, now-existing name)
        // still get staged.
        const stageable = await this.filterStageable(opts.paths);
        if (stageable.length > 0) {
          await run(this.root, ["add", "-A", "--", ...stageable]);
        }
      } else {
        await this.stageAll();
      }
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
      const r = await run(this.root, args, { allowFail: true });
      if (r.code !== 0) {
        if (r.stdout.includes("nothing to commit") || r.stderr.includes("nothing to commit")) {
          return null;
        }
        // The commit itself failed after staging succeeded (a rejecting
        // hook, disk full, a lock held by another process). `git commit`
        // commits the whole index, not just this call's own pathspecs, so
        // leaving these files staged would let the next commitAll call (a
        // different actor's group, in the same flush) sweep them in under
        // its own authorship. Unstage exactly what this call staged before
        // surfacing the error, so the index is clean for whoever runs next.
        if (opts.paths && opts.paths.length > 0) {
          await run(this.root, ["reset", "--", ...opts.paths], { allowFail: true });
        } else {
          await run(this.root, ["reset"], { allowFail: true });
        }
        throw new Error(r.stderr || r.stdout);
      }
      return this.headSha();
    });
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
