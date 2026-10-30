import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

// Regression for Codex r2 #12: index/RAG mutation handlers checked the
// ".md" extension case-sensitively (missing ".MD"), and restoring a
// trashed directory only notified on the folder's own path, which never
// ends in .md, so the index never picked the restored notes back up.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-restore-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("index notifications are extension-case-insensitive", () => {
  test("writing a .MD file updates the index", async () => {
    await handle.vault.writeNote("Upper.MD", "# Upper\n\nfindable-term\n");
    // handleEvent fires fire-and-forget off vault.notify for the index
    // listener (it's awaited), so by the time writeNote resolves the
    // index should already reflect it.
    expect(handle.index.get("Upper.MD")).toBeTruthy();
  });
});

describe("restoring a trashed directory reindexes every note inside it", () => {
  test("full-text search finds a note that came back via folder restore", async () => {
    await handle.vault.writeNote("folder/a.md", "# A\n\nuniquely-searchable-content\n");
    await handle.vault.writeNote("folder/sub/b.md", "# B\n\nalso here\n");
    await handle.index.updatePath("folder/a.md");
    await handle.index.updatePath("folder/sub/b.md");

    const trashed = await handle.vault.deleteFolder("folder");
    expect(handle.index.get("folder/a.md")).toBeUndefined();

    const restoredPath = await handle.vault.restoreFromTrash(trashed);
    expect(restoredPath).toBe("folder");

    // Without per-note restore events, these would still be missing from
    // the index (the folder's own "write" notify doesn't end in .md).
    expect(handle.index.get("folder/a.md")).toBeTruthy();
    expect(handle.index.get("folder/sub/b.md")).toBeTruthy();
  });
});
