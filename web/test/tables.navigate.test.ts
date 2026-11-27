import { describe, expect, test } from "bun:test";
import { enterEdit, formatEdit, tabEdit, type CursorEdit } from "../src/tables/navigate";

const MARK = "§";
function at(src: string): [string, number] {
  const pos = src.indexOf(MARK);
  return [src.replace(MARK, ""), pos];
}
function apply(text: string, e: CursorEdit) {
  const out = text.slice(0, e.from) + e.insert + text.slice(e.to);
  return { out, selected: out.slice(e.anchor, e.head), caret: e.anchor };
}
const lineOf = (s: string, i: number) => s.slice(s.lastIndexOf("\n", i - 1) + 1).split("\n")[0];
const col = (s: string, i: number) => i - (s.lastIndexOf("\n", i - 1) + 1);

describe("tabEdit", () => {
  test("moves to the next cell, selects its text and re-pads", () => {
    const [text, pos] = at(`intro\n\n| a${MARK} | b |\n|---|---|\n| 1 | 2 |\n`);
    const r = apply(text, tabEdit(text, pos, 1)!);
    expect(r.out).toBe("intro\n\n| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
    expect(r.selected).toBe("b");
  });

  test("wraps to the next row", () => {
    const [text, pos] = at(`| a | b${MARK} |\n|---|---|\n| 1 | 2 |\n`);
    expect(apply(text, tabEdit(text, pos, 1)!).selected).toBe("1");
  });

  test("from the delimiter row goes to the first body cell", () => {
    const [text, pos] = at(`| a | b |\n|-${MARK}--|---|\n| 1 | 2 |\n`);
    expect(apply(text, tabEdit(text, pos, 1)!).selected).toBe("1");
  });

  test("after the last cell appends a row with the caret in its first cell", () => {
    const [text, pos] = at(`| a | b |\n|---|---|\n| 1 | 2${MARK} |\n`);
    const r = apply(text, tabEdit(text, pos, 1)!);
    expect(r.out.trimEnd().split("\n")).toHaveLength(4);
    expect(lineOf(r.out, r.caret)).toBe("|     |     |");
    expect(col(r.out, r.caret)).toBe(2);
  });

  test("Shift-Tab moves back and stays put at the first cell", () => {
    const [text, pos] = at(`| a | b |\n|---|---|\n| 1${MARK} | 2 |\n`);
    expect(apply(text, tabEdit(text, pos, -1)!).selected).toBe("b");
    const [t2, p2] = at(`| a${MARK} | b |\n|---|---|\n| 1 | 2 |\n`);
    expect(apply(t2, tabEdit(t2, p2, -1)!).selected).toBe("a");
  });

  test("is null outside a table and inside fenced code", () => {
    const [text, pos] = at(`plain${MARK} text\n`);
    expect(tabEdit(text, pos, 1)).toBeNull();
    const [fenced, fp] = at(`\`\`\`\n| a |\n|---|\n| x${MARK} |\n\`\`\`\n`);
    expect(tabEdit(fenced, fp, 1)).toBeNull();
  });

  test("keeps CRLF line endings", () => {
    const text = "| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\n";
    const r = apply(text, tabEdit(text, 2, 1)!);
    expect(r.out).toBe("| a   | b   |\r\n| --- | --- |\r\n| 1   | 2   |\r\n");
  });
});

describe("enterEdit", () => {
  test("moves down in the same column", () => {
    const [text, pos] = at(`| a | b |\n|---|---|\n| 1${MARK} | 2 |\n| 3 | 4 |\n`);
    expect(apply(text, enterEdit(text, pos)!).selected).toBe("3");
  });

  test("from the header goes to the first body row", () => {
    const [text, pos] = at(`| a | b${MARK} |\n|---|---|\n| 1 | 2 |\n`);
    expect(apply(text, enterEdit(text, pos)!).selected).toBe("2");
  });

  test("on the last row appends a row and keeps the column", () => {
    const [text, pos] = at(`| a | b |\n|---|---|\n| 1 | 2${MARK} |\n`);
    const r = apply(text, enterEdit(text, pos)!);
    expect(r.out.trimEnd().split("\n")).toHaveLength(4);
    expect(lineOf(r.out, r.caret)).toBe("|     |     |");
    expect(col(r.out, r.caret)).toBe(8);
  });

  test("is null outside a table", () => {
    expect(enterEdit("hello\n", 2)).toBeNull();
  });
});

describe("formatEdit", () => {
  test("re-pads the whole table and keeps the caret in its cell", () => {
    const [text, pos] = at(`| a${MARK} | b |\n|-|-|\n| long text | x |`);
    const r = apply(text, formatEdit(text, pos)!);
    expect(r.out).toBe(
      [
        `| ${"a".padEnd(9)} | ${"b".padEnd(3)} |`,
        `| ${"-".repeat(9)} | ${"-".repeat(3)} |`,
        `| long text | ${"x".padEnd(3)} |`,
      ].join("\n"),
    );
    expect(r.out.slice(0, r.caret).endsWith("| ")).toBe(true);
    expect(lineOf(r.out, r.caret).startsWith("| a")).toBe(true);
  });

  test("an already tidy table yields an empty change", () => {
    const [text, pos] = at(`| a${MARK}   | b   |\n| --- | --- |\n| 1   | 2   |\n`);
    const e = formatEdit(text, pos)!;
    expect(e.insert).toBe("");
    expect(e.from).toBe(e.to);
  });
});

describe("ragged rows", () => {
  test("Tab into a padded missing cell selects nothing", () => {
    const [text, pos] = at(`| a | b |\n|---|---|\n| 1${MARK} |\n`);
    expect(apply(text, tabEdit(text, pos, 1)!).selected).toBe("");
  });
});
