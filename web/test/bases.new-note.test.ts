import { describe, expect, test } from "bun:test";
import { buildNoteContent, caseInsensitiveExists, planNewNote, safeFileName, uniqueNotePath } from "../src/bases/new-note";

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

  test("file names and folders are made safe", () => {
    const none = () => false;
    expect(uniqueNotePath("../a/./b", none)).toBe("a/b/Untitled.md");
    expect(uniqueNotePath("", none, "a/b")).toBe("a b.md");
    expect(uniqueNotePath("", none, "con")).toBe("con_.md");
    expect(uniqueNotePath("", none, "..")).toBe("Untitled.md");
    expect(uniqueNotePath("", none, ".hidden. ")).toBe("hidden.md");
    expect(uniqueNotePath("", none, "x".repeat(300))).toBe(`${"x".repeat(100)}.md`);
    expect(safeFileName('a:b*c?"d')).toBe("a b c d");
    expect(uniqueNotePath("", caseInsensitiveExists(["UNTITLED.md"]))).toBe("Untitled 1.md");
    expect(uniqueNotePath("", caseInsensitiveExists(["untitled.md", "Untitled 1.md"]))).toBe("Untitled 2.md");
    expect(uniqueNotePath("a:b/con/x*y", none)).toBe("a b/con_/x y/Untitled.md");
    const emoji = "\u{1F600}".repeat(101);
    expect(uniqueNotePath("", none, emoji)).toBe(`${"\u{1F600}".repeat(100)}.md`);
  });

  test("the fallback name is checked too", () => {
    const stamp = 5;
    const real = Date.now;
    Date.now = () => stamp;
    try {
      const p = uniqueNotePath("", (q) => !q.includes("5"));
      expect(p).toBe("Untitled 5.md");
      const q = uniqueNotePath("", (x) => !x.includes("-1"));
      expect(q).toBe("Untitled 5-1.md");
    } finally {
      Date.now = real;
    }
  });

  test("unsafe numbers stay strings; blank tags and escapes", () => {
    const plan = planNewNote(["a == 9007199254740993", "b == -0", "c == 1.5", "d == 12", 'file.hasTag("  ")', 'e == "x\\ny"', 'f == "a\\qb"']);
    expect(plan.props).toEqual({ a: "9007199254740993", b: "-0", c: 1.5, d: 12, e: "x\ny", f: "a\\qb" });
    expect(buildNoteContent("a\nb", {})).toBe("# a b\n\n");
  });
});
