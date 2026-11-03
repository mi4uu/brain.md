import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/vault/vault";
import { loadFolderMeta, resolveFolderPerms } from "../src/api/folder-perms";

// Audit P0: a corrupt or unreadable folder-meta.json must fail CLOSED
// (deny every folder) rather than fail open (the pre-existing behaviour
// defaulted a load error to an empty `mcp` map, read by resolveFolderPerms
// as "no folder has ever been restricted", i.e. full read+write access
// everywhere).

let dir: string;
let vault: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-fperms-failclosed-"));
  vault = new Vault(dir);
  await mkdir(join(dir, ".brain"), { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadFolderMeta: fail closed on a corrupt or unreadable file", () => {
  test("a missing folder-meta.json is NOT corruption: default open (empty mcp map)", async () => {
    const meta = await loadFolderMeta(vault);
    expect(meta.mcp).toEqual({});
    expect(resolveFolderPerms("anything.md", meta.mcp)).toEqual({ read: true, write: true });
  });

  test("malformed JSON fails closed: every folder denied, not defaulted open", async () => {
    await writeFile(join(dir, ".brain", "folder-meta.json"), "{ not valid json ::: ");
    const meta = await loadFolderMeta(vault);
    expect(resolveFolderPerms("a/b.md", meta.mcp)).toEqual({ read: false, write: false });
    expect(resolveFolderPerms("top-level.md", meta.mcp)).toEqual({ read: false, write: false });
  });

  test("an unreadable file (permission denied) fails closed too", async () => {
    // root bypasses file permission bits entirely, so this scenario can't
    // be exercised when the test runner itself runs as root (some CI
    // containers do).
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const path = join(dir, ".brain", "folder-meta.json");
    await writeFile(path, JSON.stringify({ version: 1, icons: {}, colors: {}, mcp: {} }));
    await chmod(path, 0o000);
    try {
      const meta = await loadFolderMeta(vault);
      expect(resolveFolderPerms("a/b.md", meta.mcp)).toEqual({ read: false, write: false });
    } finally {
      // So afterEach's rm() can actually remove the tree.
      await chmod(path, 0o644).catch(() => undefined);
    }
  });

  test("a valid file with real overrides still resolves normally (not a false positive)", async () => {
    await writeFile(
      join(dir, ".brain", "folder-meta.json"),
      JSON.stringify({ version: 1, icons: {}, colors: {}, mcp: { Private: { read: false, write: false } } }),
    );
    const meta = await loadFolderMeta(vault);
    expect(resolveFolderPerms("Private/secret.md", meta.mcp)).toEqual({ read: false, write: false });
    expect(resolveFolderPerms("Public/note.md", meta.mcp)).toEqual({ read: true, write: true });
  });
});
