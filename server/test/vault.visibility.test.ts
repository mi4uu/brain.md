import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { search } from "../src/index/search";

let dir!: string;
let handle!: AppHandle;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-visibility-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
  await handle.settings.load();
  const notes: Record<string, string> = {
    "Start.md": "# Start\nkiwi [[Journal/telefon]] [[_template]] [[draft]]\n",
    "Journal/telefon.md": "# Telefon\nkiwi agent scratch\n",
    "Journal/2026-11-18.md": "# Day\nkiwi\n",
    "_template.md": "# Template\nkiwi\n",
    "draft.md": "---\nsearch: false\n---\n# Draft\nkiwi\n",
    "secret-ish.md": "---\nhidden: true\n---\n# Hidden\nkiwi\n",
    "old/archive/x.md": "# X\nkiwi\n",
  };
  for (const [p, c] of Object.entries(notes)) {
    await handle.vault.writeNote(p, c);
    await handle.index.updatePath(p);
  }
  await mkdir(join(dir, ".obsidian"), { recursive: true });
  await writeFile(join(dir, ".obsidian", "workspace.md"), "# not a note\n");
  await handle.settings.patch({ hidden: ["Journal/telefon.md", "**/_*", "old/**"] });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const hits = (opts?: { includeHidden?: boolean }) =>
  search(handle.index, "kiwi", undefined, undefined, opts)
    .map((h) => h.path)
    .sort();

describe("hidden and excluded notes", () => {
  test("search skips hidden globs, hidden: true and search: false; include_hidden brings them back", () => {
    expect(hits()).toEqual(["Journal/2026-11-18.md", "Start.md"]);
    expect(hits({ includeHidden: true })).toHaveLength(7);
  });

  test("the tree lists hidden notes and folders separately; dot folders are not notes", async () => {
    const r = await handle.app.handle(new Request("http://localhost/api/tree"));
    const tree = (await r.json()) as { notes: string[]; hiddenNotes: string[]; hiddenFolders: string[] };
    expect(tree.notes.some((n) => n.startsWith(".obsidian"))).toBe(false);
    expect(tree.hiddenNotes.sort()).toEqual(["Journal/telefon.md", "_template.md", "old/archive/x.md", "secret-ish.md"]);
    expect(tree.hiddenFolders.sort()).toEqual(["old", "old/archive"]);
    expect(tree.notes).toContain("draft.md");
  });

  test("graph and semantic indexing leave them out; reading by path still works", async () => {
    const g = await (await handle.app.handle(new Request("http://localhost/api/graph"))).json();
    const ids = (g as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["Journal/2026-11-18.md", "Start.md"]);
    expect(handle.ragPipeline.isExcluded("draft.md")).toBe(true);
    expect(handle.ragPipeline.isExcluded("Start.md")).toBe(false);
    expect((await handle.vault.readNote("Journal/telefon.md")).content).toContain("agent scratch");
  });
});
