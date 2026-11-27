import { describe, expect, test } from "bun:test";
import {
  cellRange,
  columnAt,
  deleteColumn,
  deleteRow,
  escapeCell,
  findTableAt,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseTable,
  serializeTable,
  setAlign,
  setCell,
  splitRow,
  type MdTable,
} from "../src/tables/md-table";

const SRC = ["| Name | Qty |", "|---|---:|", "| apple | 3 |", "| kiwi | 12 |"];
const parsed = (lines: string[] = SRC): MdTable => {
  const t = parseTable(lines);
  if (!t) throw new Error("not a table");
  return t;
};

describe("parseTable", () => {
  test("reads header, alignment and rows", () => {
    expect(parsed()).toEqual({
      header: ["Name", "Qty"],
      align: [null, "right"],
      rows: [["apple", "3"], ["kiwi", "12"]],
    });
  });

  test("leading and trailing pipes are optional", () => {
    const t = parsed(["a | b", "--- | :-:", "1 | 2"]);
    expect(t.header).toEqual(["a", "b"]);
    expect(t.align).toEqual([null, "center"]);
    expect(t.rows).toEqual([["1", "2"]]);
  });

  test("escaped pipes stay in the cell verbatim", () => {
    const t = parsed(["| a | b |", "|---|---|", "| x \\| y | `c` |"]);
    expect(t.rows[0]).toEqual(["x \\| y", "`c`"]);
  });

  test("an unescaped pipe inside code splits the cell, like the renderer", () => {
    const t = parsed(["| a | b |", "|---|---|", "| `x|y` | z |"]);
    expect(t.header).toEqual(["a", "b", ""]);
    expect(t.rows[0]).toEqual(["`x", "y`", "z"]);
  });

  test("short rows are padded", () => {
    const t = parsed(["| a | b | c |", "|---|---|---|", "| 1 |"]);
    expect(t.rows).toEqual([["1", "", ""]]);
  });

  test("rejects non tables", () => {
    expect(parseTable(["a", "b"])).toBeNull();
    expect(parseTable(["| a | b |", "|---|"])).toBeNull();
    expect(parseTable(["| a |"])).toBeNull();
  });
});

describe("serializeTable", () => {
  test("pads columns and writes the outer pipes", () => {
    expect(serializeTable(parsed())).toEqual([
      "| Name  | Qty |",
      "| ----- | --: |",
      "| apple |   3 |",
      "| kiwi  |  12 |",
    ]);
  });

  test("alignment markers and centring", () => {
    const t = parsed(["a | b", "--- | :-:", "1 | 2"]);
    expect(serializeTable(t)).toEqual(["| a   |  b  |", "| --- | :-: |", "| 1   |  2  |"]);
  });

  test("is idempotent", () => {
    const once = serializeTable(parsed());
    expect(serializeTable(parsed(once))).toEqual(once);
  });

  test("width counts code points, not UTF-16 units", () => {
    const t = parsed(["| a |", "|---|", "| \u{1F600}\u{1F600}\u{1F600}\u{1F600} |", "| ab |"]);
    expect(serializeTable(t)[3]).toBe(`| ab${" ".repeat(2)} |`);
  });
});

describe("operations", () => {
  test("setCell on body and header", () => {
    expect(setCell(parsed(), 0, 1, "9").rows[0]).toEqual(["apple", "9"]);
    expect(setCell(parsed(), -1, 0, "Item").header).toEqual(["Item", "Qty"]);
    expect(setCell(parsed(), 5, 0, "x")).toEqual(parsed());
  });

  test("insertRow adds an empty row at the index", () => {
    expect(insertRow(parsed(), 1).rows).toEqual([["apple", "3"], ["", ""], ["kiwi", "12"]]);
    expect(insertRow(parsed(), 99).rows.length).toBe(3);
  });

  test("deleteRow and moveRow", () => {
    expect(deleteRow(parsed(), 0).rows).toEqual([["kiwi", "12"]]);
    expect(moveRow(parsed(), 0, 1).rows).toEqual([["kiwi", "12"], ["apple", "3"]]);
    expect(moveRow(parsed(), 0, 0)).toEqual(parsed());
  });

  test("insertColumn keeps alignment slots in step", () => {
    const t = insertColumn(parsed(), 1);
    expect(t.header).toEqual(["Name", "", "Qty"]);
    expect(t.align).toEqual([null, null, "right"]);
    expect(t.rows[0]).toEqual(["apple", "", "3"]);
  });

  test("deleteColumn refuses to remove the last column", () => {
    expect(deleteColumn(parsed(), 0).header).toEqual(["Qty"]);
    const one = deleteColumn(parsed(), 0);
    expect(deleteColumn(one, 0)).toEqual(one);
  });

  test("moveColumn moves header, alignment and cells together", () => {
    const t = moveColumn(parsed(), 1, 0);
    expect(t.header).toEqual(["Qty", "Name"]);
    expect(t.align).toEqual(["right", null]);
    expect(t.rows[1]).toEqual(["12", "kiwi"]);
  });

  test("setAlign", () => {
    expect(setAlign(parsed(), 0, "center").align).toEqual(["center", "right"]);
  });
});

describe("findTableAt", () => {
  const doc = ["intro", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "after | pipe"];

  test("returns the 1-based line range from any table line", () => {
    for (const n of [3, 4, 5]) expect(findTableAt(doc, n)).toEqual({ from: 3, to: 5 });
  });

  test("returns null outside a table", () => {
    for (const n of [1, 2, 6, 7]) expect(findTableAt(doc, n)).toBeNull();
  });

  test("ignores tables inside fenced code", () => {
    const fenced = ["```", "| a | b |", "|---|---|", "```"];
    expect(findTableAt(fenced, 2)).toBeNull();
  });

  test("ignores blockquoted tables", () => {
    expect(findTableAt(["> | a |", "> |---|", "> | 1 |"], 1)).toBeNull();
  });

  test("ignores a list-indented table", () => {
    expect(findTableAt(["- item", "  | a | b |", "  |---|---|", "  | 1 | 2 |"], 2)).toBeNull();
  });

  test("ignores a 4-space indented block", () => {
    expect(findTableAt(["    | a | b |", "    |---|---|", "    | 1 | 2 |"], 1)).toBeNull();
  });

  test("a table can follow another", () => {
    const two = ["| a |", "|---|", "", "| b |", "|---|", "| 1 |"];
    expect(findTableAt(two, 6)).toEqual({ from: 4, to: 6 });
  });
});

describe("cell helpers", () => {
  test("splitRow reports offsets of trimmed text", () => {
    expect(splitRow("| a   | b   |")).toEqual([
      { text: "a", from: 2, to: 3 },
      { text: "b", from: 8, to: 9 },
    ]);
  });

  test("columnAt", () => {
    expect(columnAt("| a | b |", 2)).toBe(0);
    expect(columnAt("| a | b |", 6)).toBe(1);
    expect(columnAt("a | b", 4)).toBe(1);
  });

  test("cellRange of an empty cell sits after the padding space", () => {
    expect(cellRange("|     |     |", 0)).toEqual({ from: 2, to: 2 });
    expect(cellRange("| a |", 3)).toBeNull();
  });

  test("escapeCell escapes bare pipes, keeps escaped ones, flattens newlines", () => {
    expect(escapeCell("a|b")).toBe("a\\|b");
    expect(escapeCell("a\\|b")).toBe("a\\|b");
    expect(escapeCell("a\nb")).toBe("a b");
    expect(escapeCell("  x  ")).toBe("x");
  });
});
