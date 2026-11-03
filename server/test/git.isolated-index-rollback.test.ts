import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-isolated-index-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function indexBlob(path: string): string {
  const proc = Bun.spawnSync(["git", "-C", dir, "show", `:${path}`]);
  return proc.stdout.toString();
}

describe("GitRepo.commitAll: isolated index on a rejected commit", () => {
  // Must-fix regression: the old code staged straight into the repo's
  // real index and, on a rejected commit (a pre-commit hook here, but
  // the same applies to a disk-full write or a lock held by another
  // process), ran `git reset -- <paths>` with allowFail:true and never
  // checked whether it actually succeeded. A reset that itself fails
  // (e.g. an index.lock left behind by whatever just rejected the
  // commit) used to leave those paths silently staged for whatever
  // commitAll call ran next, crediting them to the wrong actor.
  //
  // Should-fix regression, exercised by the same scenario: that same
  // `git reset -- <paths>` resets the index to HEAD for those paths even
  // when the real index held a *different*, user-staged version of one
  // of them before this call ever started, destroying it instead of
  // leaving it alone.
  //
  // Staging and committing through a private, temporary index (see
  // GitRepo.commitWithIsolatedIndex) closes both at once: the real index
  // is never written to while staging or attempting the commit, so a
  // rejected commit leaves it exactly as it was. There is nothing to
  // roll back, and so nothing whose success needs verifying.
  test("a rejected commit never touches the real index's pre-existing staged content", async () => {
    await writeFile(join(dir, "a.md"), "v1");
    await repo.commitAll("seed");

    // Stage a version of a.md in the REAL index that differs from both
    // HEAD and whatever ends up on disk next.
    await writeFile(join(dir, "a.md"), "staged-version");
    Bun.spawnSync(["git", "-C", dir, "add", "a.md"]);
    expect(indexBlob("a.md").trim()).toBe("staged-version");

    // Now move the working tree on again, so index, HEAD and disk are
    // three different versions.
    await writeFile(join(dir, "a.md"), "newest-disk-version");

    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, '#!/bin/sh\nexit 1\n');
    await chmod(hookPath, 0o755);

    await expect(
      repo.commitAll("attempt", { paths: ["a.md"], author: { name: "Alice", email: "alice@brain.local" } }),
    ).rejects.toThrow();

    // The real index's pre-existing staged entry for a.md must be
    // untouched: still "staged-version", not reset to HEAD's "v1".
    expect(indexBlob("a.md").trim()).toBe("staged-version");
    // Nor did the rejected attempt touch the working tree.
    const disk = await Bun.file(join(dir, "a.md")).text();
    expect(disk).toBe("newest-disk-version");

    // The repo must still be usable afterwards: a later, successful
    // commitAll for the same path commits the current disk content.
    await rm(hookPath);
    const sha = await repo.commitAll("retry", { paths: ["a.md"], author: { name: "Bob", email: "bob@brain.local" } });
    expect(sha).toBeTruthy();
    const show = Bun.spawnSync(["git", "-C", dir, "show", `${sha}:a.md`]);
    expect(show.stdout.toString()).toBe("newest-disk-version");
  });

  // Must-fix regression, narrower: a failed group's own paths must not
  // leave anything staged in the real index for a *different* actor's
  // next commitAll call (in the same flush) to inherit.
  test("a failed commit leaves the real index clean for the next commitAll call", async () => {
    await writeFile(join(dir, "alice.md"), "a1");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    await writeFile(hookPath, '#!/bin/sh\ntest ! -f "$(git rev-parse --show-toplevel)/FAIL_COMMIT"\n');
    await chmod(hookPath, 0o755);
    await writeFile(join(dir, "FAIL_COMMIT"), "");

    await expect(
      repo.commitAll("alice change", { paths: ["alice.md"], author: { name: "Alice", email: "alice@brain.local" } }),
    ).rejects.toThrow();

    await rm(join(dir, "FAIL_COMMIT"));
    await writeFile(join(dir, "bob.md"), "b1");
    const sha = await repo.commitAll("bob change", {
      paths: ["bob.md"],
      author: { name: "Bob", email: "bob@brain.local" },
    });
    expect(sha).toBeTruthy();
    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", sha!]);
    expect(show.stdout.toString()).toContain("bob.md");
    expect(show.stdout.toString()).not.toContain("alice.md");
  });
});
