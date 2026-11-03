import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";
import { Autocommit } from "../src/git/autocommit";
import { localIdentity } from "../src/auth/identity";

// Regression coverage for the hang diagnosed against this module: an
// earlier version split each flush into one commit per actor via a
// private, temporary git index (GIT_INDEX_FILE) plus a step to reconcile
// the real index afterwards, and flush()'s own retry at the bottom of the
// method was an unbounded, un-cancellable, un-awaited `setTimeout`. A
// commit that kept failing the same way forever (its target directory
// gone, a permission error) rescheduled that retry every 50ms forever,
// which keeps Bun's event loop non-idle: `bun test` could print a clean
// final pass/fail summary and then just sit there. Every test in this
// file carries an explicit timeout so a reintroduced hang fails the test
// itself quickly instead of wedging the whole run.

let dir: string;
let repo: GitRepo;
let ac: Autocommit | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-autocommit-nohang-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  ac?.dispose();
  await rm(dir, { recursive: true, force: true });
});

describe("Autocommit: no unbounded retry, no index-lock race", () => {
  test(
    "a persistently failing commit retries a bounded number of times, then stops rescheduling",
    async () => {
      const owner = localIdentity("Owner", "owner@brain.local");
      let calls = 0;
      const alwaysFail: Pick<GitRepo, "isEnabled" | "hasChanges" | "dirtyPaths" | "commitAll"> = {
        isEnabled: async () => true,
        hasChanges: () => repo.hasChanges(),
        dirtyPaths: () => repo.dirtyPaths(),
        commitAll: async () => {
          calls++;
          throw new Error("simulated: permanently uncommittable");
        },
      };
      ac = new Autocommit(alwaysFail as unknown as GitRepo, { enabled: true, debounceMs: 20 });
      await writeFile(join(dir, "a.md"), "x");
      ac.notify("a.md", owner);

      await ac.flush();
      // Give every bounded retry (MAX_RETRIES in autocommit.ts, 50ms
      // apart) time to fire, plus slack, then confirm the call count has
      // actually plateaued instead of still climbing.
      await new Promise((resolve) => setTimeout(resolve, 600));
      const callsAfterSettling = calls;
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(calls).toBe(callsAfterSettling);
      // A bounded number of attempts, not one call per flush forever.
      expect(calls).toBeGreaterThan(1);
      expect(calls).toBeLessThan(20);
    },
    { timeout: 5000 },
  );

  test(
    "dispose() cancels a pending retry so it never fires against a removed directory",
    async () => {
      const owner = localIdentity("Owner", "owner@brain.local");
      let calls = 0;
      const failOnce: Pick<GitRepo, "isEnabled" | "hasChanges" | "dirtyPaths" | "commitAll"> = {
        isEnabled: async () => true,
        hasChanges: () => repo.hasChanges(),
        dirtyPaths: () => repo.dirtyPaths(),
        commitAll: async (message, opts) => {
          calls++;
          if (calls === 1) throw new Error("simulated transient failure");
          return repo.commitAll(message, opts);
        },
      };
      ac = new Autocommit(failOnce as unknown as GitRepo, { enabled: true, debounceMs: 20 });
      await writeFile(join(dir, "a.md"), "x");
      ac.notify("a.md", owner);
      await ac.flush();
      expect(calls).toBe(1);

      // Dispose right after the failure, before its retry timer (50ms)
      // fires, then remove the directory the way a test's own afterEach
      // would. If the retry weren't cancelled it would now fail forever
      // against a nonexistent directory.
      ac.dispose();
      await rm(dir, { recursive: true, force: true });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(calls).toBe(1);

      // A disposed instance also ignores further notify()/flush() calls,
      // rather than reviving.
      ac.notify("b.md", owner);
      expect(await ac.flush()).toBeNull();
      expect(calls).toBe(1);
    },
    { timeout: 5000 },
  );

  // Concurrency: a burst of notify()s across several actors, interleaved
  // with explicit flush() calls (mirroring the debounce timer firing
  // mid-burst in production), must settle on a clean working tree with
  // every path committed somewhere, never lost, and never racing for
  // .git/index.lock long enough to hang. hasChanges()/dirtyPaths() are
  // now serialized through the same queue as commitAll() (git.ts), so
  // this is also the regression test for that lock-contention class.
  test(
    "a burst of notify()s across actors, interleaved with flush(), settles cleanly without hanging",
    async () => {
      const alice = localIdentity("Alice", "alice@brain.local");
      const bob = localIdentity("Bob", "bob@brain.local");
      ac = new Autocommit(repo, { enabled: true, debounceMs: 20 });

      const files = Array.from({ length: 12 }, (_, i) => `note-${i}.md`);
      const flushes: Array<Promise<string | null>> = [];
      for (let i = 0; i < files.length; i++) {
        await writeFile(join(dir, files[i]!), `content ${i}`);
        ac.notify(files[i]!, i % 2 === 0 ? alice : bob);
        if (i % 3 === 0) flushes.push(ac.flush());
      }
      flushes.push(ac.flush());
      await Promise.all(flushes);
      // Anything left pending after the bursts above.
      await ac.flush();

      const status = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]);
      expect(status.stdout.toString().trim()).toBe("");
      for (const f of files) {
        const show = Bun.spawnSync(["git", "-C", dir, "log", "--all", "--format=%H", "--", f]);
        expect(show.stdout.toString().trim().length).toBeGreaterThan(0);
      }
    },
    { timeout: 10_000 },
  );

  // `git status` without --no-optional-locks can refresh-and-write
  // .git/index as a side effect, contending for .git/index.lock with an
  // in-progress commit. Firing hasChanges()/dirtyPaths() concurrently
  // with a real commitAll() must not throw a lock error or hang, it must
  // simply wait its turn (see the serialize() comment in git.ts).
  test(
    "hasChanges()/dirtyPaths() reads never race a concurrent commitAll() for the index lock",
    async () => {
      await writeFile(join(dir, "seed.md"), "seed");
      const commit = repo.commitAll("seed", { paths: ["seed.md"] });
      const reads = Promise.all([repo.hasChanges(), repo.dirtyPaths(), repo.hasChanges()]);
      const [sha, [, , ]] = await Promise.all([commit, reads]);
      expect(sha).toBeTruthy();
      expect(await repo.hasChanges()).toBe(false);
    },
    { timeout: 5000 },
  );
});
