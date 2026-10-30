import { describe, expect, test } from "bun:test";
import { isSafeTarEntryType, parseTarVerboseLine } from "../src/web/serve";

// Regression for Codex r2 #20: the Tier-3 web bundle download only checked
// entry *names* for traversal, never entry *types*, so a symlink or
// hardlink inside an otherwise path-safe archive would extract as-is.

describe("parseTarVerboseLine / isSafeTarEntryType", () => {
  test("accepts a regular file", () => {
    const e = parseTarVerboseLine("-rw-r--r-- user/group 123 2024-01-01 00:00 index.html");
    expect(e.typeChar).toBe("-");
    expect(e.name).toBe("index.html");
    expect(isSafeTarEntryType(e)).toBe(true);
  });

  test("accepts a directory", () => {
    const e = parseTarVerboseLine("drwxr-xr-x user/group 0 2024-01-01 00:00 assets/");
    expect(e.typeChar).toBe("d");
    expect(isSafeTarEntryType(e)).toBe(true);
  });

  test("rejects a symlink", () => {
    const e = parseTarVerboseLine(
      "lrwxrwxrwx user/group 0 2024-01-01 00:00 assets/evil.js -> /etc/passwd",
    );
    expect(e.typeChar).toBe("l");
    expect(e.name).toBe("assets/evil.js");
    expect(isSafeTarEntryType(e)).toBe(false);
  });

  test("rejects a hardlink even when shown with a regular-file type char", () => {
    const e = parseTarVerboseLine(
      "-rw-r--r-- user/group 0 2024-01-01 00:00 assets/dup.js link to assets/real.js",
    );
    expect(isSafeTarEntryType(e)).toBe(false);
  });

  test("rejects a character device", () => {
    const e = parseTarVerboseLine("crw-rw-rw- user/group 0 2024-01-01 00:00 dev/null");
    expect(isSafeTarEntryType(e)).toBe(false);
  });
});
