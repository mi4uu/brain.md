import { describe, expect, test } from "bun:test";
import { applyEdit, readTable, tableEdit } from "../src/tables/apply";
import { insertColumn, setCell } from "../src/tables/md-table";

const NOTE = "---\ntitle: x\n---\n\nintro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nafter\n";
const RANGE = { from: 7, to: 9 };

describe("tableEdit", () => {
  test("replaces exactly the table lines", () => {
    const edit = tableEdit(NOTE, RANGE, (t) => setCell(t, 0, 0, "10"));
    expect(edit).not.toBeNull();
    const out = applyEdit(NOTE, edit!);
    expect(out).toBe(
      "---\ntitle: x\n---\n\nintro\n\n| a   | b   |\n| --- | --- |\n| 10  | 2   |\n\nafter\n",
    );
  });

  test("keeps CRLF", () => {
    const crlf = "| a | b |\r\n|---|---|\r\n| 1 | 2 |\r\nafter\r\n";
    const out = applyEdit(crlf, tableEdit(crlf, { from: 1, to: 3 }, (t) => insertColumn(t, 2))!);
    expect(out).toBe(
      "| a   | b   |     |\r\n| --- | --- | --- |\r\n| 1   | 2   |     |\r\nafter\r\n",
    );
  });

  test("an unchanged table yields an empty edit", () => {
    const tidy = "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n";
    expect(tableEdit(tidy, { from: 1, to: 3 }, (t) => t)).toEqual({ from: 0, to: 0, insert: "" });
  });

  test("returns null for a bad range or a non table", () => {
    expect(tableEdit(NOTE, { from: 5, to: 6 }, (t) => t)).toBeNull();
    expect(tableEdit(NOTE, { from: 7, to: 99 }, (t) => t)).toBeNull();
    expect(tableEdit(NOTE, { from: 0, to: 2 }, (t) => t)).toBeNull();
  });

  test("readTable parses the range", () => {
    expect(readTable(NOTE, RANGE)?.rows).toEqual([["1", "2"]]);
  });
});
