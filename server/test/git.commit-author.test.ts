import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-git-author-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function rawLog(): Promise<string> {
  const proc = Bun.spawn(["git", "-C", dir, "log", "-1", "--format=%an%x1f%ae%x1f%B"], {
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

describe("GitRepo.commitAll: author + trailers", () => {
  test("no opts keeps the previous behaviour (committer config as author)", async () => {
    await writeFile(join(dir, "a.md"), "x");
    await repo.commitAll("plain");
    const [name, email] = (await rawLog()).split("\x1f");
    expect(name).toBe("brain.md");
    expect(email).toBe("brain@local");
  });

  test("author option overrides the author, committer stays brain.md", async () => {
    await writeFile(join(dir, "a.md"), "x");
    await repo.commitAll("with author", { author: { name: "ci-bot", email: "bot@brain.local" } });
    const [name, email] = (await rawLog()).split("\x1f");
    expect(name).toBe("ci-bot");
    expect(email).toBe("bot@brain.local");
    const committer = Bun.spawnSync(["git", "-C", dir, "log", "-1", "--format=%cn"]);
    expect(committer.stdout.toString().trim()).toBe("brain.md");
  });

  test("trailers are appended after a blank line", async () => {
    await writeFile(join(dir, "a.md"), "x");
    await repo.commitAll("msg", { trailers: { "On-Behalf-Of": "apikey:1", Agent: "ci-bot" } });
    const [, , body] = (await rawLog()).split("\x1f");
    expect(body).toContain("msg\n\nOn-Behalf-Of: apikey:1\nAgent: ci-bot");
  });

  test("paths option stages only the given pathspecs, leaving others pending", async () => {
    await writeFile(join(dir, "a.md"), "a1");
    await writeFile(join(dir, "b.md"), "b1");
    const sha = await repo.commitAll("only a", { paths: ["a.md"] });
    expect(sha).toBeTruthy();
    const status = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]);
    expect(status.stdout.toString()).toContain("b.md");
    expect(status.stdout.toString()).not.toContain("a.md");
  });

  test("author name/email with angle brackets can't inject a second pair", async () => {
    await writeFile(join(dir, "a.md"), "x");
    await repo.commitAll("inj", { author: { name: "evil> <x@evil.com", email: "ok@brain.local" } });
    const [name] = (await rawLog()).split("\x1f");
    expect(name).not.toContain("<");
    expect(name).not.toContain(">");
  });
});
