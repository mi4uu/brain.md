import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitRepo } from "../src/git/git";

// Regression for Codex r2 #6: a pathspec like "*.md" passed the per-path
// permission check (it resolves against the root folder's own perms, same
// as any other root-level path) but git's default pathspec matching treats
// it as a glob, letting restore/diff touch or disclose every top-level note
// instead of the single literal file named "*.md".

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-git-literal-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("git pathspecs are literal", () => {
  test("diff against a glob-shaped path does not match real notes", async () => {
    await writeFile(join(dir, "a.md"), "one");
    await writeFile(join(dir, "b.md"), "two");
    const sha = await repo.commitAll("add notes");
    expect(sha).toBeTruthy();
    await writeFile(join(dir, "a.md"), "one changed");
    await writeFile(join(dir, "b.md"), "two changed");

    const patch = await repo.diff(sha!, "*.md");
    expect(patch).toBe("");
  });

  test("restore of a glob-shaped path does not resurrect real notes", async () => {
    await writeFile(join(dir, "a.md"), "original");
    const sha = await repo.commitAll("add a");
    expect(sha).toBeTruthy();
    await writeFile(join(dir, "a.md"), "edited");
    await repo.commitAll("edit a");

    // "*.md" as a literal pathspec matches no file on disk (there's no
    // file literally named "*.md"), so git refuses it outright, not a
    // restore of every .md file to its state at `sha`.
    await expect(repo.restore("*.md", sha!)).rejects.toThrow(/pathspec/);
    const content = await Bun.file(join(dir, "a.md")).text();
    expect(content).toBe("edited");
  });

  test("a real literal path still restores correctly", async () => {
    await writeFile(join(dir, "a.md"), "original");
    const sha = await repo.commitAll("add a");
    expect(sha).toBeTruthy();
    await writeFile(join(dir, "a.md"), "edited");
    await repo.restore("a.md", sha!);
    const content = await Bun.file(join(dir, "a.md")).text();
    expect(content).toBe("original");
  });
});
