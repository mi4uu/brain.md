import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
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

  test("a trailer value with newlines can't forge a second trailer line", async () => {
    await writeFile(join(dir, "a.md"), "x");
    await repo.commitAll("inj", {
      trailers: { Agent: "Helper\nOn-Behalf-Of: forged-owner\nSigned-off-by: someone" },
    });
    const [, , body] = (await rawLog()).split("\x1f");
    expect(body).not.toContain("\nOn-Behalf-Of: forged-owner");
    expect(body).not.toContain("\nSigned-off-by: someone");
    // The attempted injection is flattened into one line, not dropped.
    expect(body).toContain("Agent: Helper On-Behalf-Of: forged-owner Signed-off-by: someone");
  });

  test("a trailer key with newlines can't inject its own line either", async () => {
    await writeFile(join(dir, "a.md"), "x");
    await repo.commitAll("inj", { trailers: { "Agent\nSigned-off-by": "someone" } });
    const [, , body] = (await rawLog()).split("\x1f");
    expect(body).not.toContain("\nSigned-off-by: someone");
  });

  test("paths covering a transient rename stage what still exists, not nothing", async () => {
    // a.md -> b.md -> c.md within one flush window: a.md is tracked and
    // now deleted, b.md never existed on disk or in the index, c.md
    // exists untracked. Without --ignore-errors the whole `git add`
    // aborts on b.md and nothing gets staged.
    await writeFile(join(dir, "a.md"), "a1");
    await repo.commitAll("seed");
    await unlink(join(dir, "a.md"));
    await writeFile(join(dir, "c.md"), "c1");
    const sha = await repo.commitAll("rename", { paths: ["a.md", "b.md", "c.md"] });
    expect(sha).toBeTruthy();
    const status = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]);
    expect(status.stdout.toString().trim()).toBe("");
    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1"]);
    expect(show.stdout.toString()).toContain("A\tc.md");
    expect(show.stdout.toString()).toContain("D\ta.md");
  });

  // Must-fix regression: `git commit` commits the whole index, not just
  // the pathspecs named on its own command line. If a commitAll call
  // staged its paths and then the commit itself failed (a rejecting
  // hook, a lock, disk full), the staged files used to stay in the
  // index. A later commitAll call for a different actor's paths would
  // then commit those leftover files too, under the wrong author.
  test("a failed commit unstages its own paths, so a later commitAll for someone else doesn't inherit them", async () => {
    await writeFile(join(dir, "alice.md"), "a1");
    const hookPath = join(dir, ".git", "hooks", "pre-commit");
    await writeFile(
      hookPath,
      '#!/bin/sh\ntest ! -f "$(git rev-parse --show-toplevel)/FAIL_COMMIT"\n',
    );
    await chmod(hookPath, 0o755);
    await writeFile(join(dir, "FAIL_COMMIT"), "");

    await expect(
      repo.commitAll("alice change", {
        paths: ["alice.md"],
        author: { name: "Alice", email: "alice@brain.local" },
      }),
    ).rejects.toThrow();

    // alice.md must be back to untracked (unstaged), not still sitting
    // staged in the index after the failed commit.
    const afterFail = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]);
    expect(afterFail.stdout.toString()).toMatch(/^\?\? alice\.md$/m);

    await unlink(join(dir, "FAIL_COMMIT"));
    await writeFile(join(dir, "bob.md"), "b1");
    const sha = await repo.commitAll("bob change", {
      paths: ["bob.md"],
      author: { name: "Bob", email: "bob@brain.local" },
    });
    expect(sha).toBeTruthy();

    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1"]);
    expect(show.stdout.toString()).toContain("bob.md");
    expect(show.stdout.toString()).not.toContain("alice.md");
    const [name] = (await rawLog()).split("\x1f");
    expect(name).toBe("Bob");
  });
});
