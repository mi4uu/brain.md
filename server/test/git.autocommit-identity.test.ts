import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";
import { Autocommit } from "../src/git/autocommit";
import { apiKeyIdentity, localIdentity } from "../src/auth/identity";

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
});
