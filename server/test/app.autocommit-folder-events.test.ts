import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { identityContext, localIdentity } from "../src/auth/identity";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-folder-events-"));
  h = createApp({ vaultDir: dir, gitAutocommit: true, gitDebounceMs: 50 });
  await h.repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const actorA = localIdentity("Alice", "alice@brain.local", "alice");
const actorB = localIdentity("Bob", "bob@brain.local", "bob");

async function as<T>(identity: ReturnType<typeof localIdentity>, fn: () => Promise<T>): Promise<T> {
  return identityContext.run(identity, fn);
}

async function authorsOf(sha: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an", sha], { stdout: "pipe" });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  return out;
}

describe("app wiring: folder mutation events into autocommit", () => {
  // Must-fix regression: deleting a folder used to queue the folder's own
  // (now nonexistent) path, which filterStageable drops entirely (not
  // tracked by that exact pathspec, not on disk any more), silently
  // losing the deletion from git.
  test("deleting a folder commits the deletion of every note under it", async () => {
    await as(actorA, () => h.vault.mkdirFolder("docs"));
    await as(actorA, () => h.vault.writeNote("docs/a.md", "hello"));
    await h.autocommit.flush();

    await as(actorA, () => h.vault.deleteFolder("docs"));
    await h.autocommit.flush();

    expect(await h.repo.hasChanges()).toBe(false);
    const proc = Bun.spawn(["git", "-C", dir, "ls-files", "docs"], { stdout: "pipe" });
    const tracked = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(tracked).toBe("");
  });

  // Must-fix regression: deleteFolder() only ever snapshotted listTree()'s
  // notes (walk() skips .media entirely, it isn't shown in the note
  // tree), so a non-markdown attachment living under the deleted folder
  // was never queued to autocommit at all: not attributed to the actor
  // who deleted it, not staged by any group, left for some other actor's
  // unrelated commit (or no commit at all) to eventually sweep up.
  test("deleting a folder also commits the deletion of a non-markdown attachment under it", async () => {
    await as(actorA, () => h.vault.mkdirFolder("docs"));
    await as(actorA, () => h.vault.writeNote("docs/a.md", "hello"));
    await as(actorA, () => h.vault.writeMedia("docs/a.md", "img.png", new Uint8Array([1, 2, 3])));
    await h.autocommit.flush();
    expect(await h.repo.hasChanges()).toBe(false);

    await as(actorB, () => h.vault.deleteFolder("docs"));
    const sha = await h.autocommit.flush();
    expect(sha).toBeTruthy();
    expect(await h.repo.hasChanges()).toBe(false);

    const proc = Bun.spawn(["git", "-C", dir, "ls-files", "docs"], { stdout: "pipe" });
    const tracked = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(tracked).toBe("");
    expect(await authorsOf(sha!)).toBe("Bob");
  });

  // Must-fix regression: creating a folder queued the directory path
  // itself. If another actor wrote a note under that folder before the
  // next flush, `git add -A -- <folder>` (run for the folder creator's
  // own commit) swept that note in too, crediting it to the folder
  // creator instead of the actor who actually wrote it.
  test("a note written into a just-created folder by another actor is credited to its own author", async () => {
    await as(actorA, () => h.vault.mkdirFolder("team"));
    await as(actorB, () => h.vault.writeNote("team/bot.md", "hi"));
    const sha = await h.autocommit.flush();
    expect(sha).toBeTruthy();

    const logProc = Bun.spawn(
      ["git", "-C", dir, "log", "--format=%H", "--", "team/bot.md"],
      { stdout: "pipe" },
    );
    const shas = (await new Response(logProc.stdout).text()).trim().split("\n").filter(Boolean);
    await logProc.exited;
    expect(shas.length).toBe(1);
    expect(await authorsOf(shas[0]!)).toBe("Bob");
  });
});
