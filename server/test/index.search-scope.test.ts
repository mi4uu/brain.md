import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/vault/vault";
import { VaultIndex } from "../src/index/index";
import { search } from "../src/index/search";
import { normalizeScope, inScope } from "../src/rag/queries";

let dir: string;
let vault: Vault;
let idx: VaultIndex;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-scope-"));
  vault = new Vault(dir);
  await vault.ensureRoot();
  await vault.writeNote("work/alpha.md", "# Alpha\nfoo at work");
  await vault.writeNote("work/projects/beta.md", "# Beta\nfoo in a subfolder");
  await vault.writeNote("private/gamma.md", "# Gamma\nfoo in private");
  idx = new VaultIndex(vault);
  await idx.buildAll();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("scope helpers", () => {
  test("normalizeScope trims slashes and blanks", () => {
    expect(normalizeScope(undefined)).toEqual([]);
    expect(normalizeScope("")).toEqual([]);
    expect(normalizeScope("/work/")).toEqual(["work"]);
    expect(normalizeScope([" work ", "", "private/"])).toEqual(["work", "private"]);
  });

  test("inScope matches folder and subfolders (prefix), not siblings", () => {
    expect(inScope("work/alpha.md", [])).toBe(true); // no scope = all
    expect(inScope("work/alpha.md", ["work"])).toBe(true);
    expect(inScope("work/projects/beta.md", ["work"])).toBe(true); // subfolder
    expect(inScope("private/gamma.md", ["work"])).toBe(false);
    expect(inScope("workspace/x.md", ["work"])).toBe(false); // no false prefix match
  });
});

describe("full-text search scope", () => {
  test("no scope returns hits from every folder", () => {
    const paths = search(idx, "foo").map((h) => h.path);
    expect(paths).toContain("work/alpha.md");
    expect(paths).toContain("work/projects/beta.md");
    expect(paths).toContain("private/gamma.md");
  });

  test("scope confines to one folder, subfolders included", () => {
    const paths = search(idx, "foo", "work").map((h) => h.path);
    expect(paths).toContain("work/alpha.md");
    expect(paths).toContain("work/projects/beta.md");
    expect(paths).not.toContain("private/gamma.md");
  });

  test("array scope unions multiple folders", () => {
    const paths = search(idx, "foo", ["private"]).map((h) => h.path);
    expect(paths).toEqual(["private/gamma.md"]);
  });
});
