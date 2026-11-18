import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let dir!: string;
let handle!: AppHandle;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-bookmarks-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
  await handle.settings.load();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("bookmarks follow their notes", () => {
  test("a rename moves the bookmark, a delete drops it", async () => {
    await handle.vault.writeNote("a.md", "# A\n");
    await handle.vault.writeNote("keep.md", "# K\n");
    await handle.settings.patch({ bookmarks: ["a.md", "keep.md"] });

    await handle.vault.renameNote("a.md", "notes/b.md");
    expect(handle.settings.get().bookmarks).toEqual(["notes/b.md", "keep.md"]);

    await handle.vault.deleteNote("notes/b.md");
    expect(handle.settings.get().bookmarks).toEqual(["keep.md"]);
  });
});
