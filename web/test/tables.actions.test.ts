import { describe, expect, test } from "bun:test";
import { parseTable } from "../src/tables/md-table";
import { TABLE_ACTIONS, ACTION_GROUPS } from "../src/tables/table-actions";
import { boundaryIndex, moveTarget } from "../src/tables/drag";

const t = parseTable(["| a | b |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"])!;
const act = (id: string) => TABLE_ACTIONS.find((a) => a.id === id)!;

describe("table actions", () => {
  test("ids are unique and every group is used", () => {
    expect(new Set(TABLE_ACTIONS.map((a) => a.id)).size).toBe(TABLE_ACTIONS.length);
    for (const g of ACTION_GROUPS) expect(TABLE_ACTIONS.some((a) => a.group === g)).toBe(true);
  });

  test("insert row above and below a body row", () => {
    expect(act("row-above").run(t, { row: 1, col: 0 }).rows).toEqual([["1", "2"], ["", ""], ["3", "4"]]);
    expect(act("row-below").run(t, { row: 0, col: 0 }).rows).toEqual([["1", "2"], ["", ""], ["3", "4"]]);
  });

  test("header rules", () => {
    const head = { row: -1, col: 0 };
    expect(act("row-above").enabled(t, head)).toBe(false);
    expect(act("delete-row").enabled(t, head)).toBe(false);
    expect(act("row-up").enabled(t, head)).toBe(false);
    expect(act("row-down").enabled(t, head)).toBe(false);
    expect(act("row-below").run(t, head).rows[0]).toEqual(["", ""]);
  });

  test("move enablement at the edges", () => {
    expect(act("row-up").enabled(t, { row: 0, col: 0 })).toBe(false);
    expect(act("row-down").enabled(t, { row: 1, col: 0 })).toBe(false);
    expect(act("col-move-left").enabled(t, { row: 0, col: 0 })).toBe(false);
    expect(act("col-move-right").enabled(t, { row: 0, col: 1 })).toBe(false);
    expect(act("col-move-right").run(t, { row: 0, col: 0 }).header).toEqual(["b", "a"]);
  });

  test("columns", () => {
    expect(act("col-left").run(t, { row: 0, col: 1 }).header).toEqual(["a", "", "b"]);
    expect(act("col-right").run(t, { row: 0, col: 0 }).header).toEqual(["a", "", "b"]);
    expect(act("delete-column").run(t, { row: 0, col: 0 }).header).toEqual(["b"]);
  });

  test("align and delete row", () => {
    expect(act("align-center").run(t, { row: 0, col: 1 }).align).toEqual([null, "center"]);
    expect(act("delete-row").run(t, { row: 0, col: 0 }).rows).toEqual([["3", "4"]]);
  });
});

describe("drag math", () => {
  test("boundaryIndex counts the centres left of the pointer", () => {
    expect(boundaryIndex([10, 30, 50], 5)).toBe(0);
    expect(boundaryIndex([10, 30, 50], 35)).toBe(2);
    expect(boundaryIndex([10, 30, 50], 99)).toBe(3);
  });

  test("moveTarget converts a boundary to a destination index", () => {
    expect(moveTarget(0, 2)).toBe(1);
    expect(moveTarget(2, 0)).toBe(0);
    expect(moveTarget(1, 1)).toBe(1);
    expect(moveTarget(1, 2)).toBe(1);
  });
});
