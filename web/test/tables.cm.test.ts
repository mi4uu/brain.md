import { describe, expect, test } from "bun:test";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { dispatchTableEdit, formatTable, tableEnter, tableTab } from "../src/tables/cm";
import { insertRow, setCell } from "../src/tables/md-table";

function stub(doc: string, anchor: number, head = anchor) {
  let state = EditorState.create({ doc, selection: { anchor, head }, extensions: [history()] });
  let last: Transaction | null = null;
  const view = {
    get state() {
      return state;
    },
    dispatch(...specs: Array<TransactionSpec | Transaction>) {
      const first = specs[0];
      last = first instanceof Transaction ? first : state.update(...(specs as TransactionSpec[]));
      state = last.state;
    },
  };
  return {
    view: view as unknown as EditorView,
    get state() {
      return state;
    },
    get last() {
      return last;
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

  test("declines a multi-line selection so the key keeps its default meaning", () => {
    const s = stub(TABLE, 0, 14);
    expect(formatTable(s.view)).toBe(false);
    expect(s.state.doc.toString()).toBe(TABLE);
  });

  test("works after Tab, which leaves a cell selected", () => {
    const s = stub(TABLE, 2);
    tableTab(1)(s.view);
    expect(formatTable(s.view)).toBe(true);
    expect(s.state.doc.toString()).toBe("| a   | b   |\n| --- | --- |\n| 1   | 2   |\n");
  });

  test("typing then Format undoes in two steps", () => {
    const s = stub(TABLE, 3);
    s.view.dispatch({ changes: { from: 3, insert: "x" }, userEvent: "input.type" });
    const typed = s.state.doc.toString();
    expect(formatTable(s.view)).toBe(true);
    expect(undo(s.view as never)).toBe(true);
    expect(s.state.doc.toString()).toBe(typed);
    expect(undo(s.view as never)).toBe(true);
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

  test("typing, Tab, typing undo as three steps", () => {
    const s = stub(TABLE, 3);
    s.view.dispatch({ changes: { from: 3, insert: "x" }, userEvent: "input.type" });
    const typed = s.state.doc.toString();
    expect(tableTab(1)(s.view)).toBe(true);
    const tabbed = s.state.doc.toString();
    const { from, to } = s.state.selection.main;
    s.view.dispatch({ changes: { from, to, insert: "Q" }, userEvent: "input.type" });
    expect(undo(s.view as never)).toBe(true);
    expect(s.state.doc.toString()).toBe(tabbed);
    expect(undo(s.view as never)).toBe(true);
    expect(s.state.doc.toString()).toBe(typed);
    expect(undo(s.view as never)).toBe(true);
    expect(s.state.doc.toString()).toBe(TABLE);
  });

  test("Enter then typing undo as two steps", () => {
    const s = stub(TABLE, 2);
    expect(tableEnter(s.view)).toBe(true);
    const entered = s.state.doc.toString();
    const { head } = s.state.selection.main;
    s.view.dispatch({ changes: { from: head, insert: "Q" }, userEvent: "input.type" });
    expect(undo(s.view as never)).toBe(true);
    expect(s.state.doc.toString()).toBe(entered);
    expect(undo(s.view as never)).toBe(true);
    expect(s.state.doc.toString()).toBe(TABLE);
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

  test("changes only the bytes that differ, so a cursor in the table stays put", () => {
    const padded = "| a   | b   |\n| --- | --- |\n| 1   | 2   |\n";
    const s = stub(padded, 2);
    expect(dispatchTableEdit(s.view, { from: 1, to: 3 }, (t) => insertRow(t, 1))).toBe(true);
    expect(s.state.doc.toString()).toBe(`${padded}|     |     |\n`);
    expect(s.state.selection.main.head).toBe(2);
    expect(s.last?.changes.desc.length).toBe(padded.length);
    expect(s.last?.isUserEvent("input.table.preview")).toBe(true);
  });

  test("returns false for a range that is not a table", () => {
    const s = stub(note, 0);
    expect(dispatchTableEdit(s.view, { from: 1, to: 2 }, (t) => t)).toBe(false);
    expect(s.state.doc.toString()).toBe(note);
  });
});
