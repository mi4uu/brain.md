import { describe, expect, test } from "bun:test";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { dispatchTableEdit, formatTable, tableEnter, tableTab } from "../src/tables/cm";
import { insertRow, setCell } from "../src/tables/md-table";

function stub(doc: string, anchor: number, head = anchor) {
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions: [history()] });
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: Array<TransactionSpec | Transaction>) {
      const first = specs[0];
      state = first instanceof Transaction ? first.state : state.update(...(specs as TransactionSpec[])).state;
    },
  };
  return {
    view: view as unknown as EditorView,
    get state() {
      return state;
    },
  };
}

const TABLE = "| a | b |\n|---|---|\n| 1 | 2 |\n";

describe("formatTable", () => {
  test("re-pads in one transaction", () => {
    const s = stub(TABLE, 2);
    expect(formatTable(s.view)).toBe(true);
    expect(s.state.doc.toString()).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
  });

  test("is false outside a table", () => {
    const s = stub("plain\n", 2);
    expect(formatTable(s.view)).toBe(false);
  });

  test("declines with a non-empty selection so the key keeps its default meaning", () => {
    const s = stub(TABLE, 0, 4);
    expect(formatTable(s.view)).toBe(false);
    expect(s.state.doc.toString()).toBe(TABLE);
  });
});

describe("table keys", () => {
  const text = (s: { state: EditorState }) => {
    const { from, to } = s.state.selection.main;
    return s.state.doc.sliceString(from, to);
  };

  test("Tab, Tab moves two cells even though the first Tab selects a cell", () => {
    const s = stub(TABLE, 2);
    expect(tableTab(1)(s.view)).toBe(true);
    expect(text(s)).toBe("b");
    expect(tableTab(1)(s.view)).toBe(true);
    expect(text(s)).toBe("1");
    expect(s.state.doc.toString().split("\n").length).toBe(TABLE.split("\n").length);
  });

  test("Shift-Tab goes back from a selected cell", () => {
    const s = stub(TABLE, 2);
    tableTab(1)(s.view);
    expect(tableTab(-1)(s.view)).toBe(true);
    expect(text(s)).toBe("a");
  });

  test("Tab then Enter moves down and does not split the row", () => {
    const s = stub(TABLE, 2);
    tableTab(1)(s.view);
    const lines = s.state.doc.toString().split("\n").length;
    expect(tableEnter(s.view)).toBe(true);
    expect(s.state.doc.toString().split("\n").length).toBe(lines);
    const { head } = s.state.selection.main;
    expect(s.state.doc.lineAt(head).number).toBe(3);
  });

  test("Tab outside a table returns false and leaves the document", () => {
    const s = stub("plain\n", 2);
    expect(tableTab(1)(s.view)).toBe(false);
    expect(tableEnter(s.view)).toBe(false);
    expect(s.state.doc.toString()).toBe("plain\n");
  });

  test("a selection spanning lines is declined", () => {
    const s = stub(TABLE, 2, 14);
    expect(tableTab(1)(s.view)).toBe(false);
  });
});

describe("dispatchTableEdit", () => {
  const note = "intro\n\n" + TABLE;
  const range = { from: 3, to: 5 };

  test("replaces only the table range", () => {
    const s = stub(note, 0);
    expect(dispatchTableEdit(s.view, range, (t) => setCell(t, 0, 0, "9"))).toBe(true);
    expect(s.state.doc.toString()).toBe("intro\n\n| a   | b   |\n| --- | --- |\n| 9   | 2   |\n");
  });

  test("one undo reverts one action, two actions need two undos", () => {
    const s = stub(note, 0);
    dispatchTableEdit(s.view, range, (t) => insertRow(t, 1));
    const afterFirst = s.state.doc.toString();
    dispatchTableEdit(s.view, { from: 3, to: 6 }, (t) => setCell(t, 0, 0, "9"));
    expect(undo(s.view as never)).toBe(true);
    expect(s.state.doc.toString()).toBe(afterFirst);
    expect(undo(s.view as never)).toBe(true);
    expect(s.state.doc.toString()).toBe(note);
  });

  test("returns false for a range that is not a table", () => {
    const s = stub(note, 0);
    expect(dispatchTableEdit(s.view, { from: 1, to: 2 }, (t) => t)).toBe(false);
    expect(s.state.doc.toString()).toBe(note);
  });
});
