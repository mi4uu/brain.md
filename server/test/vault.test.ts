import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, symlink, mkdir, writeFile } from "node:fs/promises";
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

describe("V-concurrency: revision / optimistic concurrency (#9)", () => {
  test("writeNoteChecked without baseRevision never conflicts", async () => {
    const r = await vault.writeNoteChecked("rev.md", "hello");
    expect(r.ok).toBe(true);
  });

  test("writeNoteChecked with matching baseRevision succeeds", async () => {
    const first = await vault.writeNoteChecked("rev2.md", "v1");
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    const second = await vault.writeNoteChecked("rev2.md", "v2", first.data.revision);
    expect(second.ok).toBe(true);
  });

  test("writeNoteChecked with stale baseRevision reports the conflict without writing", async () => {
    await vault.writeNote("rev3.md", "v1");
    const stale = await vault.writeNoteChecked("rev3.md", "v2", "not-the-real-hash");
    expect(stale.ok).toBe(false);
    const current = await vault.readNote("rev3.md");
    expect(current.content).toBe("v1");
  });

  test("baseRevision against an absent file is not a conflict", async () => {
    const r = await vault.writeNoteChecked("brand-new.md", "x", "irrelevant-hash");
    expect(r.ok).toBe(true);
  });
});

describe("V-concurrency: per-path locking (#10, #12)", () => {
  test("concurrent appends to the same note don't lose either paragraph", async () => {
    await vault.writeNote("append.md", "base");
    await Promise.all([
      vault.appendNote("append.md", "from A"),
      vault.appendNote("append.md", "from B"),
    ]);
    const final = await vault.readNote("append.md");
    expect(final.content).toContain("from A");
    expect(final.content).toContain("from B");
  });

  test("concurrent renames onto the same target: one wins, the other is refused, nothing is lost", async () => {
    await vault.writeNote("src1.md", "one");
    await vault.writeNote("src2.md", "two");
    const results = await Promise.allSettled([
      vault.renameNote("src1.md", "dest.md"),
      vault.renameNote("src2.md", "dest.md"),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected").length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);
    // The rename that lost the race never ran (it threw EXISTS under the
    // lock before touching the filesystem), so its source file is still
    // sitting right where it was — never silently dropped.
    const destContent = await vault.readNote("dest.md");
    expect(["one", "two"]).toContain(destContent.content);
    const loserPath = destContent.content === "one" ? "src2.md" : "src1.md";
    const loserContent = await vault.readNote(loserPath);
    expect(loserContent.content).toBe(destContent.content === "one" ? "two" : "one");
  });

  test("mutateNote serialises concurrent read-modify-writes to the same note", async () => {
    await vault.writeNote("mutate.md", "[[Old]] and [[Old]]");
    const [a, b] = await Promise.all([
      vault.mutateNote("mutate.md", (c) => (c ? c.replace("[[Old]]", "[[A]]") : null)),
      vault.mutateNote("mutate.md", (c) => (c ? c.replace("[[Old]]", "[[B]]") : null)),
    ]);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const final = await vault.readNote("mutate.md");
    // Each mutation only ever sees the other's completed result, never a
    // torn read — so both substitutions land, nothing is overwritten.
    expect(final.content).toBe("[[A]] and [[B]]");
  });
});

describe("V-concurrency: atomic write temp files (#11)", () => {
  test("many concurrent writes to the same path never collide on a shared tmp name", async () => {
    const writes = Array.from({ length: 20 }, (_, i) => vault.writeNote("hot.md", `v${i}`));
    const results = await Promise.allSettled(writes);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const final = await vault.readNote("hot.md");
    expect(final.content.startsWith("v")).toBe(true);
    const entries = await readdir(dir);
    expect(entries.some((e) => e.includes(".tmp-"))).toBe(false);
  });
});

describe("symlink escape (V52/V67 follow-up)", () => {
  test("readNote refuses a symlinked directory pointing outside the vault", async () => {
    const outside = await mkdtemp(join(tmpdir(), "brain-outside-"));
    try {
      await writeFile(join(outside, "secret.md"), "top secret", "utf8");
      await mkdir(join(dir, "public"), { recursive: true });
      await symlink(outside, join(dir, "public", "link"));
      await expect(vault.readNote("public/link/secret.md")).rejects.toMatchObject({
        code: "TRAVERSAL",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("writeNote refuses to follow a symlinked directory outside the vault", async () => {
    const outside = await mkdtemp(join(tmpdir(), "brain-outside-"));
    try {
      await mkdir(join(dir, "public"), { recursive: true });
      await symlink(outside, join(dir, "public", "link"));
      await expect(vault.writeNote("public/link/new.md", "x")).rejects.toMatchObject({
        code: "TRAVERSAL",
      });
      await expect(stat(join(outside, "new.md"))).rejects.toBeDefined();
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("readMedia refuses a symlinked file pointing outside the vault", async () => {
    const outside = await mkdtemp(join(tmpdir(), "brain-outside-"));
    try {
      await writeFile(join(outside, "secret.bin"), "top secret", "utf8");
      await mkdir(join(dir, "note", ".media"), { recursive: true });
      await symlink(join(outside, "secret.bin"), join(dir, "note", ".media", "link.bin"));
      await expect(vault.readMedia("note/.media/link.bin")).rejects.toMatchObject({
        code: "TRAVERSAL",
      });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
