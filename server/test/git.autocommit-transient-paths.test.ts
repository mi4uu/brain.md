import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";
import { Autocommit } from "../src/git/autocommit";
import { localIdentity } from "../src/auth/identity";

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-autocommit-paths-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Autocommit: transient paths within one flush window", () => {
  // Regression: a.md -> b.md -> c.md queues all three paths before
  // flush. b.md never exists on disk or in the index by the time flush
  // runs, which used to abort the whole `git add` and lose the group's
  // other, real changes (the a.md deletion, the c.md addition).
  test("a rename chain's intermediate path doesn't discard the batch", async () => {
    const owner = localIdentity("Owner", "owner@brain.local");
    await writeFile(join(dir, "a.md"), "a1");
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    ac.notify("a.md", owner);
    await ac.flush();

    await unlink(join(dir, "a.md"));
    await writeFile(join(dir, "c.md"), "c1");
    ac.notify("a.md", owner);
    ac.notify("b.md", owner);
    ac.notify("c.md", owner);

    const sha = await ac.flush();
    expect(sha).toBeTruthy();

    const status = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]);
    expect(status.stdout.toString().trim()).toBe("");
    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1"]);
    expect(show.stdout.toString()).toContain("A\tc.md");
    expect(show.stdout.toString()).toContain("D\ta.md");
  });
});

describe("Autocommit: a group that fails to commit is kept for retry", () => {
  test("a commitAll rejection puts the group's paths back instead of dropping them", async () => {
    const owner = localIdentity("Owner", "owner@brain.local");
    await writeFile(join(dir, "a.md"), "a1");

    let calls = 0;
    const failOnce: Pick<GitRepo, "isEnabled" | "hasChanges" | "dirtyPaths" | "commitAll"> = {
      isEnabled: async () => true,
      // Real dirty state, not hardcoded true: flush() checks hasChanges()
      // again after the per-actor loop (to pick up anything left dirty by
      // no notified actor at all), and a stub that always says "dirty"
      // regardless of what actually got committed would make that second
      // check fire a spurious extra commitAll call of its own.
      hasChanges: () => repo.hasChanges(),
      dirtyPaths: () => repo.dirtyPaths(),
      commitAll: async (message, opts) => {
        calls++;
        if (calls === 1) throw new Error("simulated: lock held by another process");
        return repo.commitAll(message, opts);
      },
    };
    const ac = new Autocommit(failOnce as unknown as GitRepo, { enabled: true, debounceMs: 50 });
    ac.notify("a.md", owner);

    const first = await ac.flush();
    expect(first).toBeNull();
    expect(calls).toBe(1);

    // flush() schedules its own retry (setTimeout(..., 50)) because the
    // failed group's paths are still pending; wait past it rather than
    // calling flush() again, to exercise that retry path too.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(calls).toBe(2);

    const status = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]);
    expect(status.stdout.toString()).not.toContain("a.md");
  });
});
