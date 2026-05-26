import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/vault/vault";
import { VaultError } from "../src/vault/types";

let dir: string;
let vault: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-vault-"));
  vault = new Vault(dir);
  await vault.ensureRoot();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("paths V2 (no traversal)", () => {
  test("rejects ../", async () => {
    await expect(vault.readNote("../etc/passwd")).rejects.toBeInstanceOf(
      VaultError,
    );
  });
  test("rejects absolute path", async () => {
    await expect(vault.readNote("/etc/passwd")).rejects.toBeInstanceOf(
      VaultError,
    );
  });
  test("rejects null byte", async () => {
    await expect(vault.readNote("foo\0.md")).rejects.toBeInstanceOf(
      VaultError,
    );
  });
  test("rejects backslash traversal", async () => {
    await expect(vault.readNote("..\\evil.md")).rejects.toBeInstanceOf(
      VaultError,
    );
  });
});

describe("V1 markdown ext", () => {
  test("rejects non-md write", async () => {
    await expect(vault.writeNote("foo.txt", "hi")).rejects.toBeInstanceOf(
      VaultError,
    );
  });
  test("accepts .md", async () => {
    const data = await vault.writeNote("foo.md", "hi");
    expect(data.content).toBe("hi");
  });
});

describe("V6 atomic write", () => {
  test("writeNote produces file, no .tmp lingering", async () => {
    await vault.writeNote("a.md", "alpha");
    const entries = await readdir(dir);
    const tmpFiles = entries.filter((e) => e.includes(".tmp-"));
    expect(tmpFiles.length).toBe(0);
    const got = await readFile(join(dir, "a.md"), "utf8");
    expect(got).toBe("alpha");
  });
  test("writeNote creates parent dirs", async () => {
    await vault.writeNote("a/b/c.md", "x");
    const got = await readFile(join(dir, "a/b/c.md"), "utf8");
    expect(got).toBe("x");
  });
});

describe("V13 trash on delete", () => {
  test("deleteNote moves to trash, original gone", async () => {
    await vault.writeNote("note.md", "data");
    const trashRel = await vault.deleteNote("note.md");
    expect(trashRel.startsWith(".brain/trash/")).toBe(true);
    await expect(stat(join(dir, "note.md"))).rejects.toBeDefined();
    const trashed = await readFile(join(dir, trashRel), "utf8");
    expect(trashed).toBe("data");
  });
  test("deleteFolder trashes whole dir", async () => {
    await vault.writeNote("d/a.md", "x");
    await vault.writeNote("d/b.md", "y");
    const trashRel = await vault.deleteFolder("d");
    expect(trashRel.startsWith(".brain/trash/")).toBe(true);
    await expect(stat(join(dir, "d"))).rejects.toBeDefined();
    const trashedA = await readFile(join(dir, trashRel, "a.md"), "utf8");
    expect(trashedA).toBe("x");
  });
  test("refuse delete .brain", async () => {
    await expect(vault.deleteFolder(".brain")).rejects.toBeInstanceOf(
      VaultError,
    );
  });
});

describe("listTree", () => {
  test("skips .brain and .media files", async () => {
    await vault.writeNote("a.md", "x");
    await vault.writeNote("sub/b.md", "y");
    await vault.writeMedia("a.md", "img.png", new Uint8Array([1, 2, 3]));
    const tree = await vault.listTree();
    expect(tree.notes).toEqual(["a.md", "sub/b.md"]);
    expect(tree.folders).toEqual(["sub"]);
  });
});

describe("media V3", () => {
  test("writeMedia for note <dir>/note.md → <dir>/.media/<file>", async () => {
    await vault.writeNote("folder/n.md", "x");
    const rel = await vault.writeMedia(
      "folder/n.md",
      "img.png",
      new Uint8Array([1, 2, 3]),
    );
    expect(rel).toBe("folder/.media/img.png");
    const got = await readFile(join(dir, rel));
    expect(got.length).toBe(3);
  });
  test("media at root note → /.media/<file>", async () => {
    await vault.writeNote("n.md", "x");
    const rel = await vault.writeMedia(
      "n.md",
      "i.png",
      new Uint8Array([9]),
    );
    expect(rel).toBe(".media/i.png");
  });
  test("media filename sanitization rejects slashes", async () => {
    await vault.writeNote("n.md", "x");
    await expect(
      vault.writeMedia("n.md", "../evil.png", new Uint8Array([0])),
    ).rejects.toBeInstanceOf(VaultError);
  });
});

describe("rename", () => {
  test("renames note file", async () => {
    await vault.writeNote("old.md", "v");
    await vault.renameNote("old.md", "new.md");
    const got = await readFile(join(dir, "new.md"), "utf8");
    expect(got).toBe("v");
    await expect(stat(join(dir, "old.md"))).rejects.toBeDefined();
  });
  test("renameNote refuses overwrite", async () => {
    await vault.writeNote("a.md", "1");
    await vault.writeNote("b.md", "2");
    await expect(vault.renameNote("a.md", "b.md")).rejects.toBeInstanceOf(
      VaultError,
    );
  });
});

describe("mkdir folder", () => {
  test("creates nested folder", async () => {
    await vault.mkdirFolder("a/b/c");
    const s = await stat(join(dir, "a/b/c"));
    expect(s.isDirectory()).toBe(true);
  });
});
