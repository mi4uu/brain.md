import { describe, expect, test } from "bun:test";
import { buildTree, type Node } from "../src/components/FileTree";

const data = {
  folders: ["Journal", "Projects", "Archive"],
  notes: [
    "Journal/2026-11-18.md",
    "Journal/2026-10-02.md",
    "Journal/2025-12-31.md",
    "Journal/telefon.md",
    "Projects/b.md",
    "Projects/a.md",
    "Archive/old.md",
    "_template.md",
  ],
  hiddenNotes: ["Journal/telefon.md", "_template.md", "Archive/old.md"],
  hiddenFolders: ["Archive"],
  mtimes: { "Projects/a.md": 100, "Projects/b.md": 200 },
};

const names = (n: Node | undefined): string[] => (n?.children ?? []).map((c) => c.name);
const child = (n: Node | undefined, name: string) => n?.children.find((c) => c.name === name);

describe("tree view", () => {
  test("journal notes are grouped by year and month, newest first", () => {
    const root = buildTree(data, { showHidden: false, sort: {}, dailyDir: "Journal" });
    const journal = child(root, "Journal");
    expect(names(journal)).toEqual(["2026", "2025"]);
    expect(names(child(journal, "2026"))).toEqual(["11 November", "10 October"]);
    expect(names(child(child(journal, "2026"), "11 November"))).toEqual(["2026-11-18.md"]);
  });

  test("hidden notes and folders are left out unless shown, then marked", () => {
    const hidden = buildTree(data, { showHidden: false, sort: {}, dailyDir: "Journal" });
    expect(names(hidden)).toEqual(["Journal", "Projects"]);
    const shown = buildTree(data, { showHidden: true, sort: {}, dailyDir: "Journal" });
    expect(child(shown, "Archive")?.hidden).toBe(true);
    expect(child(shown, "_template.md")?.hidden).toBe(true);
    expect(child(child(shown, "Journal"), "telefon.md")?.hidden).toBe(true);
  });

  test("a folder's own sort order wins", () => {
    const byName = buildTree(data, { showHidden: false, sort: { Projects: "name-desc" }, dailyDir: "" });
    expect(names(child(byName, "Projects"))).toEqual(["b.md", "a.md"]);
    const oldest = buildTree(data, { showHidden: false, sort: { Projects: "modified-asc" }, dailyDir: "" });
    expect(names(child(oldest, "Projects"))).toEqual(["a.md", "b.md"]);
  });
});
