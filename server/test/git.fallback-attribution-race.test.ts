import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";
import { Autocommit } from "../src/git/autocommit";
import { localIdentity } from "../src/auth/identity";

let dir: string;
let repo: GitRepo;
let ac: Autocommit | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-fallback-race-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  // Must-dispose: an undisposed Autocommit can have a live retry timer
  // (see autocommit.ts's module comment on the hang this closes). Cancel
  // it before the temp directory it points at is removed, or a retry
  // firing afterward against a now-deleted directory would keep failing
  // and rescheduling itself.
  ac?.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function authorOf(sha: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an", sha], { stdout: "pipe" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

async function bodyOf(sha: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%B", sha], { stdout: "pipe" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

describe("git.ts dirtyPaths(): untracked directories", () => {
  // Must-fix regression: without --untracked-files=all, `git status`
  // collapses a wholly-untracked directory into one line for the
  // directory itself ("new folder/"), which can never match a concrete
  // pending file path like "new folder/b.md". dirtyPaths() is the one
  // thing autocommit's fallback case compares against pendingPaths, so a
  // collapsed directory entry always looks unclaimed even when every file
  // under it is actually claimed.
  test("lists every file under a wholly-untracked directory individually, not the directory itself", async () => {
    await mkdir(join(dir, "new folder"), { recursive: true });
    await writeFile(join(dir, "new folder", "b.md"), "bob's note");
    const paths = await repo.dirtyPaths();
    expect(paths).toContain("new folder/b.md");
    expect(paths).not.toContain("new folder/");
  });
});

describe("Autocommit: one combined commit per flush, dirty-but-unclaimed paths included", () => {
  // Design: flush() no longer splits a window into "per-actor commits
  // plus a fallback commit for whatever's left dirty". It makes exactly
  // one commit covering every notified path plus every other dirty path,
  // see autocommit.ts's module comment for why the old per-actor split
  // (and its "fallback" step) was removed. A file nobody ever notified
  // still has to land in that one commit.
  test("a file inside a brand-new, wholly-untracked directory is included even though nobody notified it", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const bob = localIdentity("Bob", "bob@brain.local");

    await writeFile(join(dir, "stray.md"), "nobody's file");
    ac.notify("new folder/b.md", bob); // notified but not actually written yet
    await mkdir(join(dir, "new folder"), { recursive: true });
    await writeFile(join(dir, "new folder", "b.md"), "bob's note");

    const sha = await ac.flush();
    expect(sha).toBeTruthy();
    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", sha!]);
    expect(show.stdout.toString()).toContain("stray.md");
    expect(show.stdout.toString()).toContain("new folder/b.md");
  });

  // A notify() landing on a genuinely unclaimed path while flush()'s own
  // hasChanges() await is still in flight must be folded into THIS
  // flush's commit under its real author, see the "snapshot" design note
  // in autocommit.ts. Covered end-to-end here with a single actor so the
  // commit has one author, not a Changed-by trailer.
  test("a notify() racing the dirty check lands in this flush's commit under its own author", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const bob = localIdentity("Bob", "bob@brain.local");

    await writeFile(join(dir, "stray.md"), "nobody's file");

    const originalHasChanges = repo.hasChanges.bind(repo);
    let fired = false;
    (repo as unknown as { hasChanges: () => Promise<boolean> }).hasChanges = async () => {
      if (!fired) {
        fired = true;
        await writeFile(join(dir, "bob.md"), "bob's write");
        ac!.notify("bob.md", bob);
      }
      return originalHasChanges();
    };

    const sha = await ac.flush();
    expect(sha).toBeTruthy();
    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", sha!]);
    expect(show.stdout.toString()).toContain("stray.md");
    expect(show.stdout.toString()).toContain("bob.md");
    expect(await authorOf(sha!)).toBe("Bob");
  });
});

describe("Autocommit: a single known actor never silently absorbs an unclaimed path", () => {
  // Must-fix regression: describeCommit() used to decide "one actor, no
  // trailers needed" from pendingPaths alone, so a path dirtyPaths()
  // added to the commit that nobody notified (see the describe block
  // above) landed under that one actor's name with zero trailer telling
  // the two apart, even though the actual committed path set had two
  // sources. Every unclaimed path must now get its own "Changed-by"
  // trailer no matter how few actors notify()'d.
  test("Bob's notified file plus an independently-dirty, unnotified file: commit is Bob's, stray gets its own trailer", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const bob = localIdentity("Bob", "bob@brain.local");

    await writeFile(join(dir, "bob-file.md"), "bob's note");
    ac.notify("bob-file.md", bob);
    await writeFile(join(dir, "stray.md"), "nobody's file");

    const sha = await ac.flush();
    expect(sha).toBeTruthy();
    expect(await authorOf(sha!)).toBe("Bob");
    const body = await bodyOf(sha!);
    // The unclaimed path must be named explicitly, never silently folded
    // into Bob's authorship with no trace it wasn't his.
    expect(body).toContain("Changed-by: stray.md");
  });
});

describe("Autocommit: mixed actors in one flush get a Changed-by trailer, not a raced commit", () => {
  // Design: Bob overwriting Alice's file before the flush that covers it
  // runs is no longer a race at all, both end up in the SAME commit
  // (whoever notified last for that path wins the pendingPaths entry,
  // same keyed-by-path rule as before). There is nothing left to race
  // mid-commit because there's only one commitAll call per flush, fully
  // serialized by GitRepo itself.
  test("Bob overwriting Alice's queued file before flush credits the latest notify(), not both", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const alice = localIdentity("Alice", "alice@brain.local");
    const bob = localIdentity("Bob", "bob@brain.local");

    await writeFile(join(dir, "shared.md"), "alice's text");
    ac.notify("shared.md", alice);
    await writeFile(join(dir, "shared.md"), "bob's text");
    ac.notify("shared.md", bob);

    const sha = await ac.flush();
    expect(sha).toBeTruthy();
    expect(await authorOf(sha!)).toBe("Bob");
    const show = Bun.spawnSync(["git", "-C", dir, "show", `${sha}:shared.md`]);
    expect(show.stdout.toString()).toBe("bob's text");

    const log = Bun.spawnSync(["git", "-C", dir, "log", "--all", "--format=%an"]);
    const authors = log.stdout.toString().trim().split("\n");
    expect(authors).not.toContain("Alice");
  });
});
