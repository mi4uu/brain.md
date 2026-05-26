import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";
import { Autocommit } from "../src/git/autocommit";

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-git-"));
  repo = new GitRepo(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("GitRepo V16-V18", () => {
  test("ensure: initialises repo + .gitignore + first commit", async () => {
    await repo.ensure();
    expect(await repo.isEnabled()).toBe(true);
    const ignore = await readFile(join(dir, ".gitignore"), "utf8");
    expect(ignore).toContain(".brain/");
    const head = await repo.headSha();
    expect(head).toBeTruthy();
    const branch = await repo.branch();
    expect(branch).toBe("main");
  });

  test("status: clean after ensure, dirty after write, clean after commit", async () => {
    await repo.ensure();
    let s = await repo.status();
    expect(s.dirty).toBe(false);
    await writeFile(join(dir, "a.md"), "hi");
    s = await repo.status();
    expect(s.dirty).toBe(true);
    const sha = await repo.commitAll("add a");
    expect(sha).toBeTruthy();
    s = await repo.status();
    expect(s.dirty).toBe(false);
    expect(s.lastCommit?.subject).toBe("add a");
  });

  test("log returns commits newest-first", async () => {
    await repo.ensure();
    await writeFile(join(dir, "a.md"), "1");
    await repo.commitAll("c1");
    await writeFile(join(dir, "a.md"), "2");
    await repo.commitAll("c2");
    const log = await repo.log({ limit: 10 });
    expect(log[0]?.subject).toBe("c2");
    expect(log[1]?.subject).toBe("c1");
  });

  test("show + diff + restore round-trip", async () => {
    await repo.ensure();
    await writeFile(join(dir, "a.md"), "v1");
    await repo.commitAll("v1");
    const shaV1 = (await repo.headSha())!;
    await writeFile(join(dir, "a.md"), "v2");
    await repo.commitAll("v2");
    const shown = await repo.show(shaV1, "a.md");
    expect(shown.trim()).toBe("v1");
    const patch = await repo.diff(shaV1, "a.md");
    expect(patch).toContain("v1");
    expect(patch).toContain("v2");
    await repo.restore("a.md", shaV1);
    const restored = await readFile(join(dir, "a.md"), "utf8");
    expect(restored.trim()).toBe("v1");
  });

  test("invalid sha rejected (V18)", async () => {
    await repo.ensure();
    await expect(repo.show("bad-sha; rm -rf /", "a.md")).rejects.toBeDefined();
    await expect(repo.restore("a.md", "../etc")).rejects.toBeDefined();
  });

  test("path-filtered log", async () => {
    await repo.ensure();
    await writeFile(join(dir, "a.md"), "x");
    await repo.commitAll("a");
    await writeFile(join(dir, "b.md"), "y");
    await repo.commitAll("b only");
    const logA = await repo.log({ path: "a.md", limit: 10 });
    expect(logA.find((c) => c.subject === "a")).toBeDefined();
    expect(logA.find((c) => c.subject === "b only")).toBeUndefined();
  });
});

describe("Autocommit V17", () => {
  test("debounces, single commit per burst, dirty-only", async () => {
    await repo.ensure();
    const ac = new Autocommit(repo, { enabled: true, debounceMs: 50 });
    await writeFile(join(dir, "a.md"), "x");
    ac.notify("a.md");
    await writeFile(join(dir, "a.md"), "xx");
    ac.notify("a.md");
    const sha = await ac.flush();
    expect(sha).toBeTruthy();
    const log = await repo.log({ limit: 10 });
    expect(log[0]?.subject).toMatch(/^auto:/);
    const second = await ac.flush();
    expect(second).toBeNull();
  });

  test("disabled → no commit", async () => {
    await repo.ensure();
    const ac = new Autocommit(repo, { enabled: false, debounceMs: 50 });
    await writeFile(join(dir, "a.md"), "x");
    ac.notify("a.md");
    const sha = await ac.flush();
    expect(sha).toBeNull();
  });
});
