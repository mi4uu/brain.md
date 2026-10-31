import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isSafeTarEntry, isSafeTarEntryType, listTarEntries } from "../src/web/serve";

// Regression for Codex r2 #20: the Tier-3 web bundle download only checked
// entry *names* for traversal, never entry *types*, so a symlink or
// hardlink inside an otherwise path-safe archive would extract as-is.

describe("isSafeTarEntryType", () => {
  test("accepts a regular file", () => {
    expect(isSafeTarEntryType({ typeChar: "-", name: "index.html", raw: "-rw-r--r-- index.html" })).toBe(true);
  });

  test("accepts a directory", () => {
    expect(isSafeTarEntryType({ typeChar: "d", name: "assets/", raw: "drwxr-xr-x assets/" })).toBe(true);
  });

  test("rejects a symlink", () => {
    expect(
      isSafeTarEntryType({
        typeChar: "l",
        name: "assets/evil.js",
        raw: "lrwxrwxrwx assets/evil.js -> /etc/passwd",
      }),
    ).toBe(false);
  });

  test("rejects a hardlink even when shown with a regular-file type char", () => {
    expect(
      isSafeTarEntryType({
        typeChar: "-",
        name: "assets/dup.js",
        raw: "-rw-r--r-- assets/dup.js link to assets/real.js",
      }),
    ).toBe(false);
  });

  test("rejects a character device", () => {
    expect(isSafeTarEntryType({ typeChar: "c", name: "dev/null", raw: "crw-rw-rw- dev/null" })).toBe(false);
  });
});

// Regression for Codex r3 #9: parsing the filename out of `tar -tv`'s
// whitespace-separated columns picked the last field, so a name ending in
// something that looks like a trailing column (or just containing spaces)
// was silently truncated, and a `../` prefix slipped straight past the
// traversal check still attached to the wrong, truncated "safe" name.
describe("listTarEntries", () => {
  test("reports the exact entry name for a name with spaces and a traversal prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brainmd-tar-"));
    try {
      const fileName = "a file.txt";
      await writeFile(join(dir, fileName), "hi");
      const tarPath = join(dir, "out.tar.gz");
      // bsdtar/GNU tar's -s rewrites the in-archive name without needing
      // an actual path on disk called "../escape harmless.js" (which the
      // filesystem wouldn't allow as a direct child anyway).
      const proc = Bun.spawn(
        ["tar", "-czf", tarPath, "-s", ",^a file.txt$,../escape harmless.js,", "-C", dir, fileName],
        { stderr: "pipe" },
      );
      const code = await proc.exited;
      expect(code).toBe(0);

      const entries = await listTarEntries(tarPath);
      expect(entries).not.toBeNull();
      expect(entries!).toHaveLength(1);
      const entry = entries![0]!;
      expect(entry.name).toBe("../escape harmless.js");
      expect(isSafeTarEntry(entry.name)).toBe(false);
      expect(isSafeTarEntryType(entry)).toBe(true); // regular file; name is the only thing wrong with it
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("still reports an ordinary name correctly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brainmd-tar-"));
    try {
      await writeFile(join(dir, "index.html"), "<html></html>");
      const tarPath = join(dir, "out.tar.gz");
      const proc = Bun.spawn(["tar", "-czf", tarPath, "-C", dir, "index.html"], { stderr: "pipe" });
      expect(await proc.exited).toBe(0);

      const entries = await listTarEntries(tarPath);
      expect(entries).not.toBeNull();
      expect(entries![0]!.name).toBe("index.html");
      expect(isSafeTarEntry(entries![0]!.name)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
