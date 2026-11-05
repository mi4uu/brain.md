import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";
import { Autocommit } from "../src/git/autocommit";
import { apiKeyIdentity, localIdentity, oauthClientIdentity, LOCAL_SUB } from "../src/auth/identity";

let dir: string;
let repo: GitRepo;
let ac: Autocommit | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-autocommit-identity-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  // See autocommit.ts's module comment: an undisposed instance can hold a
  // live retry timer that must not outlive this test's temp directory.
  ac?.dispose();
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

async function rawLog(sha: string): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%B", sha], { stdout: "pipe" });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe("Autocommit: identity grouping", () => {
  test("notify() with no identity falls back to the pre-identity default author", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    await writeFile(join(dir, "a.md"), "x");
    ac.notify("a.md");
    await ac.flush();
    const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an"], { stdout: "pipe" });
    const name = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    expect(name).toBe("brain.md");
  });

  test("single actor across several paths → one commit, no Changed-by trailers", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local");
    await writeFile(join(dir, "a.md"), "a");
    await writeFile(join(dir, "b.md"), "b");
    ac.notify("a.md", owner);
    ac.notify("b.md", owner);
    const before = await commitCount();
    const sha = await ac.flush();
    expect(await commitCount()).toBe(before + 1);
    expect(await authorOf(sha!)).toBe("Owner");
    expect(await rawLog(sha!)).not.toContain("Changed-by:");
  });

  // Design: two distinct actors in one flush window still get exactly ONE
  // commit, not two, see autocommit.ts's module comment for why the old
  // one-commit-per-actor split was removed. The audit trail survives as a
  // "Changed-by: <path> <actor>" trailer per path instead.
  test("two distinct actors in one window → one commit, author is the owner, with a Changed-by trailer per path", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local");
    const bot = apiKeyIdentity("apikey:1", "ci-bot");
    await writeFile(join(dir, "a.md"), "a");
    await writeFile(join(dir, "b.md"), "b");
    ac.notify("a.md", owner);
    ac.notify("b.md", bot);
    const before = await commitCount();
    const sha = await ac.flush();
    expect(await commitCount()).toBe(before + 1);
    // The owner (the one human actor in this flush) is the author,
    // never the hardcoded "brain.md" local fallback: there's a real
    // accountable person right here, no need to fall back past them.
    expect(await authorOf(sha!)).toBe("Owner");
    const body = await rawLog(sha!);
    expect(body).toContain("Changed-by: a.md Owner");
    expect(body).toContain("Changed-by: b.md ci-bot");
  });

  test("the same path notified twice before flush keeps only the latest actor", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
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
  // would merge all of them into "one actor" and drop the Changed-by
  // trailer that distinguishes them.
  test("a human session and an oauth client sharing LOCAL_SUB still get distinct Changed-by entries", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local", LOCAL_SUB);
    const agent = oauthClientIdentity(LOCAL_SUB, "Claude Desktop", "client-1");
    await writeFile(join(dir, "human.md"), "a");
    await writeFile(join(dir, "agent.md"), "b");
    ac.notify("human.md", owner);
    ac.notify("agent.md", agent);
    const before = await commitCount();
    const sha = await ac.flush();
    expect(await commitCount()).toBe(before + 1);
    expect(await authorOf(sha!)).toBe("Owner");
    const body = await rawLog(sha!);
    expect(body).toContain("Changed-by: human.md Owner");
    expect(body).toContain("Changed-by: agent.md Claude Desktop");
  });

  // No human actor at all in this flush: falls back to the hardcoded
  // local identity, not any one of the agent credentials.
  test("two different oauth clients both consented with the password still get distinct Changed-by entries", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const clientA = oauthClientIdentity(LOCAL_SUB, "Claude Desktop", "client-a");
    const clientB = oauthClientIdentity(LOCAL_SUB, "Cursor", "client-b");
    await writeFile(join(dir, "a.md"), "a");
    await writeFile(join(dir, "b.md"), "b");
    ac.notify("a.md", clientA);
    ac.notify("b.md", clientB);
    const before = await commitCount();
    const sha = await ac.flush();
    expect(await commitCount()).toBe(before + 1);
    expect(await authorOf(sha!)).toBe("brain.md");
    const body = await rawLog(sha!);
    expect(body).toContain("Changed-by: a.md Claude Desktop");
    expect(body).toContain("Changed-by: b.md Cursor");
  });

  // Regression: v0.4.12 committed a dirty repo on flush() even with no
  // paths queued (an external edit, a restart that lost pendingPaths, or
  // a direct flush() call). The identity-grouping rewrite must keep doing
  // that, falling back to the default author.
  test("flush() with a dirty repo and nothing queued still commits, falling back to the default author", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
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

  // The fallback above must never swallow paths another notified actor is
  // already carrying: it only adds paths that are ACTUALLY dirty and NOT
  // already in this flush's snapshot.
  test("a notify() racing the dirty check still gets its own author, not the fallback's", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    const owner = localIdentity("Owner", "owner@brain.local");

    const originalHasChanges = repo.hasChanges.bind(repo);
    let fired = false;
    (repo as unknown as { hasChanges: () => Promise<boolean> }).hasChanges = async () => {
      if (!fired) {
        fired = true;
        // Simulates a concurrent request's mutation landing while this
        // flush's hasChanges() call is still in flight.
        await writeFile(join(dir, "a.md"), "a");
        ac!.notify("a.md", owner);
      }
      return originalHasChanges();
    };

    const sha = await ac.flush();
    expect(sha).toBeTruthy();
    expect(await authorOf(sha!)).toBe("Owner");
  });

  test("flush() with queued paths commits under that actor, not the default", async () => {
    ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
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
