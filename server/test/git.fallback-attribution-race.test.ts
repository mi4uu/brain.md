import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";
import { Autocommit } from "../src/git/autocommit";
import { localIdentity } from "../src/auth/identity";

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-fallback-race-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function authorOf(sha: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an", sha], { stdout: "pipe" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

describe("git.ts dirtyPaths(): untracked directories", () => {
  // Must-fix regression: without --untracked-files=all, `git status`
  // collapses a wholly-untracked directory into one line for the
  // directory itself ("new folder/"), which can never match a concrete
  // pending file path like "new folder/b.md". dirtyPaths() is the one
  // thing autocommit's fallback compares against pendingPaths, so a
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

describe("Autocommit: fallback commit vs. a path claimed since the dirty scan", () => {
  // Must-fix regression (combines the two race findings): a file inside a
  // brand-new, wholly-untracked directory gets notified for Bob exactly
  // as the fallback commit's own dirtyPaths() scan is in flight (the
  // window between picking candidates and actually staging them,
  // GitRepo.commitAll). Before the fix, two independent bugs compounded:
  // dirtyPaths() reported the whole directory as one unclaimed line (not
  // the concrete file pendingPaths was keyed on), and nothing rechecked
  // pendingPaths again right before staging. Together they swept Bob's
  // file into the fallback commit under the default author, and Bob's
  // own later flush had nothing left to commit for it.
  test("a file notified inside a new directory during the fallback's own dirty scan still gets its own author", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const bob = localIdentity("Bob", "bob@brain.local");

    // A genuinely unclaimed file: dirty on disk, nobody ever notified it.
    // Gives the fallback real work to do, so this isn't just "fallback
    // finds nothing and bails".
    await writeFile(join(dir, "stray.md"), "nobody's file");

    const originalDirtyPaths = repo.dirtyPaths.bind(repo);
    let fired = false;
    (repo as unknown as { dirtyPaths: () => Promise<string[]> }).dirtyPaths = async () => {
      if (!fired) {
        fired = true;
        // Simulates Bob's real write + notify landing in the window
        // between the fallback deciding what's dirty and it actually
        // staging/committing that list.
        await mkdir(join(dir, "new folder"), { recursive: true });
        await writeFile(join(dir, "new folder", "b.md"), "bob's note");
        ac.notify("new folder/b.md", bob);
      }
      return originalDirtyPaths();
    };

    const firstSha = await ac.flush();
    expect(firstSha).toBeTruthy();

    // The fallback's own commit must hold only the genuinely unclaimed
    // file, never Bob's.
    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", firstSha!]);
    expect(show.stdout.toString()).toContain("stray.md");
    expect(show.stdout.toString()).not.toContain("new folder");
    expect(await authorOf(firstSha!)).toBe("brain.md");

    // Bob's file must still be pending, not already (mis-)committed, so
    // this flush commits it properly under Bob.
    const bobSha = await ac.flush();
    expect(bobSha).toBeTruthy();
    expect(await authorOf(bobSha!)).toBe("Bob");
    const bobShow = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", bobSha!]);
    expect(bobShow.stdout.toString()).toContain("new folder/b.md");
  });

  // Must-fix regression, isolated from the directory-collapse bug above:
  // even with flat files, fallbackCommit() picks its candidate list from
  // dirtyPaths() and then calls commitAll(), which still has its own
  // serialisation queue and filterStageable() to await before it stages
  // anything. A notify() for one of those exact candidate paths landing
  // during those awaits used to have nothing re-checking for it, so it
  // got staged and committed under the fallback author anyway.
  test("a notify() landing while the fallback's own commitAll is staging excludes that path, not swept in", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const bob = localIdentity("Bob", "bob@brain.local");

    // Both genuinely unclaimed at the moment the fallback picks its
    // candidates.
    await writeFile(join(dir, "stray.md"), "nobody's file");
    await writeFile(join(dir, "bob.md"), "will become bob's");

    const originalCommitAll = repo.commitAll.bind(repo);
    let patched = false;
    (repo as unknown as { commitAll: typeof repo.commitAll }).commitAll = (message, opts) => {
      if (!patched && opts?.paths?.includes("bob.md")) {
        patched = true;
        // Simulates Bob's real update landing after the fallback already
        // chose "bob.md" as unclaimed but before commitAll finishes
        // staging it.
        ac.notify("bob.md", bob);
      }
      return originalCommitAll(message, opts);
    };

    const sha = await ac.flush();
    expect(sha).toBeTruthy();

    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", sha!]);
    expect(show.stdout.toString()).toContain("stray.md");
    expect(show.stdout.toString()).not.toContain("bob.md");
    expect(await authorOf(sha!)).toBe("brain.md");

    const bobSha = await ac.flush();
    expect(bobSha).toBeTruthy();
    expect(await authorOf(bobSha!)).toBe("Bob");
  });
});
