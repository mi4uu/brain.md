import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";
import { Autocommit } from "../src/git/autocommit";
import { apiKeyIdentity, localIdentity, oauthClientIdentity, LOCAL_SUB } from "../src/auth/identity";

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-autocommit-identity-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function commitCount(): Promise<number> {
  const proc = Bun.spawn(["git", "-C", dir, "rev-list", "--count", "HEAD"], { stdout: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return Number(out.trim());
}

async function authorOf(sha: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an", sha], { stdout: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim();
}

describe("Autocommit: identity grouping", () => {
  test("notify() with no identity falls back to the pre-identity default author", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    await writeFile(join(dir, "a.md"), "x");
    ac.notify("a.md");
    await ac.flush();
    const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an"], { stdout: "pipe" });
    const name = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(name).toBe("brain.md");
  });

  test("single actor across several paths → one commit", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local");
    await writeFile(join(dir, "a.md"), "a");
    await writeFile(join(dir, "b.md"), "b");
    ac.notify("a.md", owner);
    ac.notify("b.md", owner);
    const before = await commitCount();
    await ac.flush();
    expect(await commitCount()).toBe(before + 1);
  });

  test("two distinct actors in one window → two commits, one per actor", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local");
    const bot = apiKeyIdentity("apikey:1", "ci-bot");
    await writeFile(join(dir, "a.md"), "a");
    await writeFile(join(dir, "b.md"), "b");
    ac.notify("a.md", owner);
    ac.notify("b.md", bot);
    const before = await commitCount();
    await ac.flush();
    expect(await commitCount()).toBe(before + 2);
  });

  test("the same path notified twice before flush keeps only the latest actor", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local");
    const bot = apiKeyIdentity("apikey:1", "ci-bot");
    await writeFile(join(dir, "a.md"), "a");
    ac.notify("a.md", owner);
    ac.notify("a.md", bot);
    await ac.flush();
    const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an"], { stdout: "pipe" });
    const name = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(name).toBe("ci-bot");
  });

  // Regression: a password-login session and an MCP client whose consent
  // was granted with the password both get sub === LOCAL_SUB, and so do
  // two different password-consented MCP clients. Grouping by sub alone
  // merged all of them into one commit, crediting whichever identity was
  // recorded first and dropping the others' Agent/On-Behalf-Of trailers.
  test("a human session and an oauth client sharing LOCAL_SUB still get separate commits", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local", LOCAL_SUB);
    const agent = oauthClientIdentity(LOCAL_SUB, "Claude Desktop", "client-1");
    await writeFile(join(dir, "human.md"), "a");
    await writeFile(join(dir, "agent.md"), "b");
    ac.notify("human.md", owner);
    ac.notify("agent.md", agent);
    const before = await commitCount();
    await ac.flush();
    expect(await commitCount()).toBe(before + 2);
  });

  test("two different oauth clients both consented with the password still get separate commits", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const clientA = oauthClientIdentity(LOCAL_SUB, "Claude Desktop", "client-a");
    const clientB = oauthClientIdentity(LOCAL_SUB, "Cursor", "client-b");
    await writeFile(join(dir, "a.md"), "a");
    await writeFile(join(dir, "b.md"), "b");
    ac.notify("a.md", clientA);
    ac.notify("b.md", clientB);
    const before = await commitCount();
    await ac.flush();
    expect(await commitCount()).toBe(before + 2);
  });

  // Regression: v0.4.12 committed a dirty repo on flush() even with no
  // paths queued (an external edit, a restart that lost pendingPaths, or
  // a direct flush() call). The identity-grouping rewrite made flush()
  // return early whenever groupByActor() produced zero groups, silently
  // leaving the dirty working tree uncommitted.
  test("flush() with a dirty repo and nothing queued still commits, falling back to the default author", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    await writeFile(join(dir, "external.md"), "written outside any notify() call");
    const before = await commitCount();
    const sha = await ac.flush();
    expect(sha).toBeTruthy();
    expect(await commitCount()).toBe(before + 1);
    const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an"], { stdout: "pipe" });
    const name = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(name).toBe("brain.md");
  });

  // The fallback above must never swallow paths another group is already
  // carrying with a real identity: it only fires when there is NOTHING
  // queued at all.
  // Must-fix regression: flush() used to snapshot pendingPaths and clear
  // it BEFORE awaiting hasChanges(). A notify() landing during that await
  // (a concurrent request's mutation, in production) was computed against
  // zero groups from the earlier snapshot, so the zero-groups fallback
  // below swept the whole dirty tree, including that notified actor's
  // change, under the fallback author instead of their own.
  test("a notify() racing the dirty check still gets its own author, not the fallback's", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local");

    const originalHasChanges = repo.hasChanges.bind(repo);
    let fired = false;
    (repo as unknown as { hasChanges: () => Promise<boolean> }).hasChanges = async () => {
      if (!fired) {
        fired = true;
        // Simulates a concurrent request's mutation landing while this
        // flush's hasChanges() call is still in flight.
        await writeFile(join(dir, "a.md"), "a");
        ac.notify("a.md", owner);
      }
      return originalHasChanges();
    };

    const sha = await ac.flush();
    expect(sha).toBeTruthy();
    expect(await authorOf(sha!)).toBe("Owner");
  });

  // Must-fix regression (f7618a5): the final fallback used to call
  // commitAll('auto') with no `paths`, so it staged EVERYTHING dirty
  // (`git add -A`). If a second actor's notify() landed while the first
  // actor's own commitAll was still running, that fallback couldn't tell
  // the newcomer's change apart from a genuinely unclaimed one and swept
  // it in under the fallback author. The newcomer's pendingPaths entry
  // then survived to be "retried" against a path already committed.
  test("a notify() arriving during another actor's commit is not swept into the fallback commit", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const alice = localIdentity("Alice", "alice@brain.local");
    const bob = apiKeyIdentity("bob-sub", "Bob", "bob-1");

    await writeFile(join(dir, "alice.md"), "a1");
    ac.notify("alice.md", alice);

    const originalCommitAll = repo.commitAll.bind(repo);
    let patched = false;
    (repo as unknown as { commitAll: typeof repo.commitAll }).commitAll = (message, opts) => {
      if (!patched && opts?.paths?.includes("alice.md")) {
        patched = true;
        // Simulates Bob's mutation landing while Alice's own commitAll is
        // still in flight, before it resolves below.
        return (async () => {
          await writeFile(join(dir, "bob.md"), "b1");
          ac.notify("bob.md", bob);
          return originalCommitAll(message, opts);
        })();
      }
      return originalCommitAll(message, opts);
    };

    const aliceSha = await ac.flush();
    expect(aliceSha).toBeTruthy();

    // Alice's own commit must hold only her file.
    const aliceShow = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", aliceSha!]);
    expect(aliceShow.stdout.toString()).toContain("alice.md");
    expect(aliceShow.stdout.toString()).not.toContain("bob.md");
    expect(await authorOf(aliceSha!)).toBe("Alice");

    // bob.md must still be pending (not already committed under the
    // fallback author), so this flush commits it properly, under Bob.
    const bobSha = await ac.flush();
    expect(bobSha).toBeTruthy();
    expect(await authorOf(bobSha!)).toBe("Bob");
    const bobShow = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", bobSha!]);
    expect(bobShow.stdout.toString()).toContain("bob.md");
    expect(bobShow.stdout.toString()).not.toContain("alice.md");
  });

  test("flush() with queued paths never takes the no-groups fallback", async () => {
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local");
    await writeFile(join(dir, "a.md"), "a");
    ac.notify("a.md", owner);
    await ac.flush();
    const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an"], { stdout: "pipe" });
    const name = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(name).toBe("Owner");
  });
});
