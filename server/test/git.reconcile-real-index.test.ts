import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-reconcile-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function indexHasPath(path: string): boolean {
  const proc = Bun.spawnSync(["git", "-C", dir, "ls-files", "--", path]);
  return proc.stdout.toString().trim() === path;
}

async function lockRealIndex(): Promise<() => Promise<void>> {
  const lockPath = join(dir, ".git", "index.lock");
  await writeFile(lockPath, "");
  return async () => {
    await rm(lockPath, { force: true });
  };
}

describe("GitRepo: real-index reconcile after a successful isolated commit", () => {
  // Must-fix regression: the old reconcile step was `git add -A` fired
  // with allowFail:true and its result thrown away. A post-commit hook
  // (or anything else) holding index.lock made it fail silently, leaving
  // the real index permanently out of sync with HEAD for that path.
  // filterStageable() consulted only that real index, so a path HEAD
  // added but the stale real index never recorded looked untracked once
  // deleted from disk too, and a later delete for it was dropped from
  // candidates entirely: the deletion never reached any commit.
  test("a failed reconcile does not block the commit, and the path's later deletion still lands in HEAD", async () => {
    await writeFile(join(dir, "a.md"), "v1");

    const unlock = await lockRealIndex();
    const seedSha = await repo.commitAll("seed a", {
      paths: ["a.md"],
      author: { name: "Alice", email: "alice@brain.local" },
    });
    // The commit itself must succeed even though its real-index reconcile
    // can't (index.lock still held): nothing here should throw or block.
    expect(seedSha).toBeTruthy();
    const seedShow = Bun.spawnSync(["git", "-C", dir, "show", `${seedSha}:a.md`]);
    expect(seedShow.stdout.toString()).toBe("v1");
    // The real index never got the reconcile (still locked): exactly the
    // staleness this regression needs to exercise next.
    expect(indexHasPath("a.md")).toBe(false);

    await rm(join(dir, "a.md"));
    const delSha = await repo.commitAll("delete a", {
      paths: ["a.md"],
      author: { name: "Bob", email: "bob@brain.local" },
    });
    expect(delSha).toBeTruthy();
    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", delSha!]);
    expect(show.stdout.toString()).toContain("D\ta.md");
    const headLs = Bun.spawnSync(["git", "-C", dir, "ls-tree", "-r", "--name-only", "HEAD"]);
    expect(headLs.stdout.toString()).not.toContain("a.md");

    await unlock();
  });

  // Should-fix regression: the old reconcile used `git add -A`, which
  // reads the CURRENT working tree, not the tree that was just committed.
  // An edit landing between the commit and the reconcile step got staged
  // into the real index as if it were already committed, so the real
  // index could show content HEAD never actually recorded. Reconciling
  // from the committed tree itself (ls-tree + update-index --index-info)
  // is immune to this: it never reads disk at all.
  test("reconcile stages exactly the committed content, not a disk edit landing after the commit", async () => {
    await writeFile(join(dir, "a.md"), "Alice");

    const originalSpawn = Bun.spawn.bind(Bun);
    let headTreeCalls = 0;
    (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = ((cmd: unknown, opts: unknown) => {
      const args = cmd as string[];
      // filterStageable() makes its own "ls-tree ... HEAD" call first, to
      // decide what's stageable at all; reconcileRealIndex()'s is the
      // second one, made only after the commit has already succeeded.
      // Firing on that second call simulates the edit landing inside
      // reconcile's own window, not before the commit exists.
      if (args[1] === "ls-tree" && args.includes("HEAD")) {
        headTreeCalls++;
        if (headTreeCalls === 2) {
          Bun.spawnSync(["sh", "-c", `printf "%s" "Later" > ${JSON.stringify(join(dir, "a.md"))}`]);
        }
      }
      return originalSpawn(cmd as never, opts as never);
    }) as typeof Bun.spawn;

    let sha: string | null;
    try {
      sha = await repo.commitAll("alice change", {
        paths: ["a.md"],
        author: { name: "Alice", email: "alice@brain.local" },
      });
    } finally {
      (Bun as unknown as { spawn: typeof Bun.spawn }).spawn = originalSpawn;
    }
    expect(sha).toBeTruthy();

    // HEAD committed "Alice", the edit never got staged anywhere.
    const headShow = Bun.spawnSync(["git", "-C", dir, "show", `${sha}:a.md`]);
    expect(headShow.stdout.toString()).toBe("Alice");

    // The real index must match what was committed ("Alice"), not the
    // edit that landed during reconcile ("Later").
    const indexShow = Bun.spawnSync(["git", "-C", dir, "show", ":a.md"]);
    expect(indexShow.stdout.toString()).toBe("Alice");

    // The disk itself still has the later edit: reconcile never touches
    // the working tree.
    const disk = await Bun.file(join(dir, "a.md")).text();
    expect(disk).toBe("Later");
  });

  // Must-fix regression, narrower: an unreconciled path (real-index
  // reconcile failed and was queued) must get retried opportunistically,
  // not left stale forever once the lock clears.
  test("an unreconciled path is retried and cleared once the real index is writable again", async () => {
    await writeFile(join(dir, "a.md"), "v1");
    const unlock = await lockRealIndex();
    await repo.commitAll("seed a", { paths: ["a.md"], author: { name: "Alice", email: "alice@brain.local" } });
    expect(indexHasPath("a.md")).toBe(false);
    await unlock();

    await writeFile(join(dir, "b.md"), "v1");
    await repo.commitAll("add b", { paths: ["b.md"], author: { name: "Bob", email: "bob@brain.local" } });

    // The next commit's opportunistic retry (now unlocked) must have
    // caught "a.md" up.
    expect(indexHasPath("a.md")).toBe(true);
  });
});
