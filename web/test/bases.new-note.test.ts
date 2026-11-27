import { describe, expect, test } from "bun:test";
import { buildNoteContent, planNewNote, uniqueNotePath } from "../src/bases/new-note";

describe("+ New note rule", () => {
  test("folder from inFolder, properties from equality, tags from hasTag", () => {
    const plan = planNewNote([
      { and: ['file.inFolder("Projects/2026")', 'status == "Todo"', "n == 3", "done == false", 'file.hasTag("work")'] },
      'note["due date"] == "soon"',
    ]);
    expect(plan).toEqual({ folder: "Projects/2026", props: { status: "Todo", n: 3, done: false, tags: ["work"], "due date": "soon" } });
  });

  test("or and not say nothing definite; non-literals and file/formula keys are skipped", () => {
    const plan = planNewNote([{ or: ['status == "A"'] }, { and: [{ not: ['status == "B"'] }, "n > 3", 'file.name == "x"', 'a == b', 'note.owner == "Ann"'] }]);
    expect(plan).toEqual({ folder: "", props: { owner: "Ann" } });
  });

  test("first folder wins; a preset (kanban column) overrides; tags merge", () => {
    const plan = planNewNote(['file.inFolder("A")', 'file.folder == "B"', 'status == "Todo"', "tags == \"x\"", 'file.hasTag("#y")'], { status: "Doing" });
    expect(plan).toEqual({ folder: "A", props: { status: "Doing", tags: ["x", "y"] } });
  });

  test("unique path and content", () => {
    expect(uniqueNotePath("A", () => false)).toBe("A/Untitled.md");
    const taken = new Set(["Untitled.md", "Untitled 1.md"]);
    expect(uniqueNotePath("", (p) => taken.has(p))).toBe("Untitled 2.md");
    expect(buildNoteContent("T", {})).toBe("# T\n\n");
    expect(buildNoteContent("T", { status: "Todo", owner: "[[Ann]]", tags: ["a"], n: 2 })).toBe(
      '---\nstatus: Todo\nowner: "[[Ann]]"\ntags:\n  - a\nn: 2\n---\n\n# T\n\n',
    );
  });
});
