# Table Editing (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit GFM pipe tables without touching pipes: Advanced Tables style keyboard editing in the editor, and click, `+`, drag, context menu and touch action bar in the preview.

**Architecture:** One pure module (`web/src/tables/md-table.ts`) parses, edits and re-pads a table. Every feature (editor keymap, preview actions) computes new table text with it and replaces exactly the table's line range in a single CodeMirror transaction (or on the `content` state when no editor view exists). The renderer tags tables with `data-source-line` and `data-source-end`; a `TableTools` React component draws overlay controls next to the rendered table, never inside the `innerHTML` that React replaces on every render.

**Tech Stack:** TypeScript, Bun test, CodeMirror 6 (`@codemirror/state|view|commands|autocomplete`), React 18, Radix (`@radix-ui/react-context-menu`, already installed), unified/remark. No new dependency.

**Spec:** `docs/plans/2026-11-26-properties-and-views-design.md`, section "Phase 3: table editing", plus "Principles" and "Out of scope".

## Global Constraints

- Commit steps show the planning session's `Claude-Session:` trailer. The executing session replaces it with its own trailer.
- No em dashes anywhere: code, comments, docs, commit messages, CHANGELOG. Use a comma, colon, semicolon or full stop.
- Comments only where a competent dev would get it wrong from the code alone (non-obvious choice, external quirk, constraint). No captions that restate code.
- Code, docs and commit messages in English.
- Every commit message ends with the trailer line `Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA` (as a separate `-m`).
- No change to how tables are stored: plain GFM pipe tables. Leading and trailing pipe optional on input, always written on output.
- No new dependency. Native pointer events for drag.
- Phones are first-class: at `pointer: coarse` every tappable control is at least 40px. At `hover: none` there are no hover controls and no drag handles; a tap selects a cell and shows an action bar with the same actions as the context menu.
- Styling is quiet and uses existing tokens only: `var(--text-1..4)`, `var(--border)`, `var(--border-strong)`, `var(--bg-hover)`, `var(--bg-surface)`, `var(--accent)`, `var(--radius-1..3)`. No new colours.
- Undo works as one step per user action. Preview actions use `isolateHistory.of("full")`.
- `tsconfig` has `noUncheckedIndexedAccess`: index reads are `T | undefined`; use `!` or `?? fallback`.
- Web tests: `cd web && bun test`. Typecheck and build: `bun run --cwd web build`. Do not run `bun install`.
- Out of scope (spec): live preview editing in general, nested property editing, plugin runtime. Also out of scope here: tables nested in blockquotes, callouts or lists (the renderer only tags top-level blocks), CSV paste, column resize, merged cells.

## Findings that shape the plan (verified against the code on this branch)

1. **Pipes in inline code split cells.** remark-gfm renders `` | `x|y` | z | `` as cells `` `x `` and `` y` ``. The spec says "pipes inside inline code handled"; the only way that is correct is the escape `\|`, which GFM unescapes inside code. So the parser follows the renderer exactly: it splits on every unescaped pipe, and keeps `\|` verbatim in the cell. The same applies to `[[note|alias]]` in a cell: it must be written `[[note\|alias]]`.
2. **Excess cells are dropped by the renderer, short rows are padded.** The model keeps the widest row (non-destructive); the preview refuses to act on a table whose DOM shape differs from the model (`matchesModel`), the editor "Format table" widens the header and so reveals the hidden cells.
3. **`remarkSourcepos` tags top-level blocks only.** Tables in blockquotes, callouts and lists get no `data-source-line`, so they are editable from the editor keymap only if they sit at column 0 (they do not: the `> ` prefix fails the delimiter check). They are simply not handled; nothing breaks.
4. **Sanitize schema needs no change.** `"*": [..., "data*"]` already lets any `data-*` attribute through; Task 5 adds a test that pins it.
5. **Preview click currently focuses the editor.** `onPreviewSelectLine` calls `view.focus()`, which would steal focus from the inline cell input. The Preview click handler must skip clicks inside a rendered, editable table.
6. **Tab today** is `indentWithTab` (indent on Tab, dedent on Shift-Tab) at the end of the keymap. The table keymap goes first and returns `false` outside tables, so non-table behaviour is unchanged. Enter must also yield to an open completion popup (`completionStatus`).
7. **Radix `ContextMenuTrigger` cannot wrap cells that live in `innerHTML`.** One trigger wraps `.doc`; it is `disabled` (native menu stays available) unless the last pointer-down landed in an editable table cell.
8. **Inline cell editing uses an `<input>` overlay, not contenteditable**: the cell must show and write the raw markdown source (wikilinks, `\|`), not rendered text.
9. The header row cannot be deleted or moved; "insert row above" is disabled on it and "insert row below" inserts as the first body row. The spec is silent on this.
10. Both panes stay mounted whenever a note is open (layout modes only toggle CSS classes), so `editorViewRef.current` is non-null in practice; the `setContent` fallback exists for safety and has no undo history.

## File Structure

| File | Responsibility |
|---|---|
| Create `web/src/tables/md-table.ts` | Pure: parse, serialise, row/column operations, `findTableAt`, cell offset helpers, `escapeCell` |
| Create `web/src/tables/apply.ts` | Pure: line-range to text-edit (`tableEdit`, `readTable`, `applyEdit`), CRLF aware |
| Create `web/src/tables/navigate.ts` | Pure: cursor-aware edits for Tab, Shift-Tab, Enter, Format (`tabEdit`, `enterEdit`, `formatEdit`) |
| Create `web/src/tables/cm.ts` | CodeMirror glue: `tableKeymap`, `formatTable`, `dispatchTableEdit` |
| Create `web/src/tables/table-actions.ts` | Pure: the action registry shared by context menu and touch bar |
| Create `web/src/tables/drag.ts` | Pure: drag boundary math |
| Create `web/src/components/TableTools.tsx` | Preview overlay: hover `+`, grips, inline editor, context menu, touch bar |
| Create `web/src/styles/tables.css` | Overlay and action bar styles |
| Modify `web/src/renderer/plugins/sourcepos.ts` | `data-source-end` on tables |
| Modify `web/src/components/Editor.tsx` | Install `tableKeymap` before the other keymaps |
| Modify `web/src/editor/actions.ts`, `web/src/components/EditorToolbar.tsx` | "Format table" toolbar button |
| Modify `web/src/components/Preview.tsx` | `onEditTable` prop, wrap `.doc` in `TableTools`, skip table clicks in the select-line handler |
| Modify `web/src/App.tsx` | `onEditTable` implementation, pass to Preview, import `tables.css` |
| Modify `web/src/styles/preview.css` | `.preview { position: relative }` |
| Tests `web/test/tables.*.test.ts`, `web/test/render.table-source.test.ts` | One file per module |
| Modify `CHANGELOG.md`, `README.md` | User-facing notes |

---

### Task 1: Pure table module

**Files:**
- Create: `web/src/tables/md-table.ts`
- Test: `web/test/tables.md-table.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact):
```ts
export type Align = "left" | "center" | "right" | null;
export interface MdTable { header: string[]; align: Align[]; rows: string[][] }
export interface LineRange { from: number; to: number }          // 1-based, inclusive
export interface RowCell { text: string; from: number; to: number } // from/to: offsets of trimmed text in the line
export function splitRow(line: string): RowCell[];
export function parseTable(lines: string[]): MdTable | null;
export function serializeTable(t: MdTable): string[];
export function setCell(t: MdTable, row: number, col: number, text: string): MdTable;   // row -1 = header
export function insertRow(t: MdTable, at: number): MdTable;      // at: index in rows, 0..rows.length
export function deleteRow(t: MdTable, row: number): MdTable;
export function moveRow(t: MdTable, from: number, to: number): MdTable;  // to: index in the resulting array
export function insertColumn(t: MdTable, at: number): MdTable;
export function deleteColumn(t: MdTable, col: number): MdTable;  // no-op on a one-column table
export function moveColumn(t: MdTable, from: number, to: number): MdTable;
export function setAlign(t: MdTable, col: number, align: Align): MdTable;
export function findTableAt(lines: string[], lineNo: number): LineRange | null;
export function columnAt(line: string, offset: number): number;
export function cellRange(line: string, col: number): { from: number; to: number } | null;
export function escapeCell(text: string): string;
```

- [ ] **Step 1: Write the failing test**

Create `web/test/tables.md-table.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/tables.md-table.test.ts`
Expected: FAIL, `Cannot find module '../src/tables/md-table'`.

- [ ] **Step 3: Write minimal implementation**

Create `web/src/tables/md-table.ts`:

```ts
export type Align = "left" | "center" | "right" | null;
export interface MdTable {
  header: string[];
  align: Align[];
  rows: string[][];
}
export interface LineRange {
  from: number;
  to: number;
}
export interface RowCell {
  text: string;
  from: number;
  to: number;
}

const FENCE = /^ {0,3}(```|~~~)/;
const DELIM_CELL = /^:?-+:?$/;
const MIN_WIDTH = 3;

function barsOf(line: string): number[] {
  const bars: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") i++;
    else if (ch === "|") bars.push(i);
  }
  return bars;
}

export function splitRow(line: string): RowCell[] {
  const bars = barsOf(line);
  const edges = [-1, ...bars, line.length];
  const cells: RowCell[] = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const a = edges[k]! + 1;
    const b = edges[k + 1]!;
    const raw = line.slice(a, b);
    const text = raw.trim();
    const from = text === "" ? Math.min(a + 1, b) : a + (raw.length - raw.trimStart().length);
    cells.push({ text, from, to: from + text.length });
  }
  if (bars.length > 0) {
    if (line.slice(0, bars[0]).trim() === "") cells.shift();
    if (line.slice(bars[bars.length - 1]! + 1).trim() === "") cells.pop();
  }
  return cells;
}

function isDelimiterRow(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIM_CELL.test(c.text));
}

function alignOf(text: string): Align {
  const l = text.startsWith(":");
  const r = text.endsWith(":");
  if (l && r) return "center";
  if (l) return "left";
  if (r) return "right";
  return null;
}

function fit<T>(arr: T[], width: number, fill: T): T[] {
  return Array.from({ length: width }, (_, i) => (i < arr.length ? (arr[i] as T) : fill));
}

function normalize(t: MdTable): MdTable {
  const width = Math.max(1, t.header.length, t.align.length, ...t.rows.map((r) => r.length));
  return {
    header: fit(t.header, width, ""),
    align: fit<Align>(t.align, width, null),
    rows: t.rows.map((r) => fit(r, width, "")),
  };
}

export function parseTable(lines: string[]): MdTable | null {
  if (lines.length < 2) return null;
  const first = lines[0]!;
  const second = lines[1]!;
  if (!first.includes("|") || !isDelimiterRow(second)) return null;
  const head = splitRow(first);
  const delim = splitRow(second);
  if (head.length === 0 || head.length !== delim.length) return null;
  return normalize({
    header: head.map((c) => c.text),
    align: delim.map((c) => alignOf(c.text)),
    rows: lines.slice(2).map((l) => splitRow(l).map((c) => c.text)),
  });
}

const vlen = (s: string): number => Array.from(s).length;

function pad(s: string, width: number, align: Align): string {
  const gap = width - vlen(s);
  if (gap <= 0) return s;
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + s + " ".repeat(gap - left);
  }
  return s + " ".repeat(gap);
}

function dashes(width: number, align: Align): string {
  if (align === "center") return `:${"-".repeat(width - 2)}:`;
  if (align === "left") return `:${"-".repeat(width - 1)}`;
  if (align === "right") return `${"-".repeat(width - 1)}:`;
  return "-".repeat(width);
}

export function serializeTable(t: MdTable): string[] {
  const n = normalize(t);
  const widths = n.header.map((h, c) =>
    Math.max(MIN_WIDTH, vlen(h), ...n.rows.map((r) => vlen(r[c] ?? ""))),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((s, c) => pad(s, widths[c]!, n.align[c] ?? null)).join(" | ")} |`;
  return [
    line(n.header),
    `| ${widths.map((w, c) => dashes(w, n.align[c] ?? null)).join(" | ")} |`,
    ...n.rows.map(line),
  ];
}

function inserted<T>(arr: T[], at: number, value: T): T[] {
  const copy = arr.slice();
  copy.splice(at, 0, value);
  return copy;
}

function moved<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function setCell(t: MdTable, row: number, col: number, text: string): MdTable {
  const n = normalize(t);
  if (col < 0 || col >= n.header.length) return n;
  if (row === -1) return { ...n, header: n.header.map((c, i) => (i === col ? text : c)) };
  if (!n.rows[row]) return n;
  return { ...n, rows: n.rows.map((r, i) => (i === row ? r.map((c, j) => (j === col ? text : c)) : r)) };
}

export function insertRow(t: MdTable, at: number): MdTable {
  const n = normalize(t);
  return { ...n, rows: inserted(n.rows, clamp(at, 0, n.rows.length), n.header.map(() => "")) };
}

export function deleteRow(t: MdTable, row: number): MdTable {
  const n = normalize(t);
  if (row < 0 || row >= n.rows.length) return n;
  return { ...n, rows: n.rows.filter((_, i) => i !== row) };
}

export function moveRow(t: MdTable, from: number, to: number): MdTable {
  const n = normalize(t);
  const last = n.rows.length - 1;
  if (from === to || from < 0 || from > last || to < 0 || to > last) return n;
  return { ...n, rows: moved(n.rows, from, to) };
}

export function insertColumn(t: MdTable, at: number): MdTable {
  const n = normalize(t);
  const i = clamp(at, 0, n.header.length);
  return {
    header: inserted(n.header, i, ""),
    align: inserted<Align>(n.align, i, null),
    rows: n.rows.map((r) => inserted(r, i, "")),
  };
}

export function deleteColumn(t: MdTable, col: number): MdTable {
  const n = normalize(t);
  if (n.header.length <= 1 || col < 0 || col >= n.header.length) return n;
  const drop = <T>(a: T[]) => a.filter((_, i) => i !== col);
  return { header: drop(n.header), align: drop(n.align), rows: n.rows.map(drop) };
}

export function moveColumn(t: MdTable, from: number, to: number): MdTable {
  const n = normalize(t);
  const last = n.header.length - 1;
  if (from === to || from < 0 || from > last || to < 0 || to > last) return n;
  return {
    header: moved(n.header, from, to),
    align: moved(n.align, from, to),
    rows: n.rows.map((r) => moved(r, from, to)),
  };
}

export function setAlign(t: MdTable, col: number, align: Align): MdTable {
  const n = normalize(t);
  if (col < 0 || col >= n.align.length) return n;
  return { ...n, align: n.align.map((a, i) => (i === col ? align : a)) };
}

const isRowLine = (l: string): boolean => l.trim() !== "" && l.includes("|") && !FENCE.test(l);

// A row line without any pipe also continues a GFM table, but ending the
// table there is the safer side for rewriting: text we do not recognise is
// left alone instead of being reflowed into a cell.
export function findTableAt(lines: string[], lineNo: number): LineRange | null {
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const next = lines[i + 1];
    if (next === undefined || !line.includes("|") || !isDelimiterRow(next)) continue;
    if (splitRow(line).length !== splitRow(next).length) continue;
    let end = i + 1;
    while (end + 1 < lines.length && isRowLine(lines[end + 1]!)) end++;
    if (lineNo >= i + 1 && lineNo <= end + 1) return { from: i + 1, to: end + 1 };
    i = end;
  }
  return null;
}

export function columnAt(line: string, offset: number): number {
  const bars = barsOf(line);
  const leading = bars.length > 0 && line.slice(0, bars[0]).trim() === "";
  const before = bars.filter((b) => b < offset).length - (leading ? 1 : 0);
  return Math.max(0, Math.min(before, splitRow(line).length - 1));
}

export function cellRange(line: string, col: number): { from: number; to: number } | null {
  const c = splitRow(line)[col];
  return c ? { from: c.from, to: c.to } : null;
}

export function escapeCell(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, " ").trim();
  let out = "";
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i]!;
    if (ch === "\\") {
      out += ch + (flat[i + 1] ?? "");
      i++;
    } else out += ch === "|" ? "\\|" : ch;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/tables.md-table.test.ts`
Expected: PASS (all tests). If the width test fails, check that `vlen` uses `Array.from`.

- [ ] **Step 5: Commit**

```bash
git add web/src/tables/md-table.ts web/test/tables.md-table.test.ts
git commit -m "feat(web): pure GFM table model with row and column operations" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 2: Line-range to text edit

**Files:**
- Create: `web/src/tables/apply.ts`
- Test: `web/test/tables.apply.test.ts`

**Interfaces:**
- Consumes: `parseTable`, `serializeTable`, `MdTable`, `LineRange` from `./md-table`.
- Produces (exact):
```ts
export interface TextEdit { from: number; to: number; insert: string }   // char offsets into the text
export function readTable(text: string, range: LineRange): MdTable | null;
export function tableEdit(text: string, range: LineRange, fn: (t: MdTable) => MdTable): TextEdit | null;
export function applyEdit(text: string, edit: TextEdit): string;
```
`tableEdit` returns `null` when the range is invalid or the lines do not parse as a table; a no-op edit is `{ from, to: from, insert: "" }`. The edit covers the table lines only, excluding the final line terminator.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/tables.apply.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { parseTable, serializeTable, type LineRange, type MdTable } from "./md-table";

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

interface Located {
  from: number;
  to: number;
  lines: string[];
  eol: string;
}

function locate(text: string, range: LineRange): Located | null {
  const parts = text.split("\n");
  if (range.from < 1 || range.to < range.from || range.to > parts.length) return null;
  let from = 0;
  for (let i = 0; i < range.from - 1; i++) from += parts[i]!.length + 1;
  const slice = parts.slice(range.from - 1, range.to);
  const last = slice[slice.length - 1]!;
  const to = from + slice.join("\n").length - (last.endsWith("\r") ? 1 : 0);
  return {
    from,
    to,
    lines: slice.map((l) => l.replace(/\r$/, "")),
    eol: slice[0]!.endsWith("\r") ? "\r\n" : "\n",
  };
}

export function readTable(text: string, range: LineRange): MdTable | null {
  const loc = locate(text, range);
  return loc ? parseTable(loc.lines) : null;
}

export function tableEdit(text: string, range: LineRange, fn: (t: MdTable) => MdTable): TextEdit | null {
  const loc = locate(text, range);
  if (!loc) return null;
  const model = parseTable(loc.lines);
  if (!model) return null;
  const insert = serializeTable(fn(model)).join(loc.eol);
  if (insert === text.slice(loc.from, loc.to)) return { from: loc.from, to: loc.from, insert: "" };
  return { from: loc.from, to: loc.to, insert };
}

export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/tables.apply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/tables/apply.ts web/test/tables.apply.test.ts
git commit -m "feat(web): replace a table's line range with edited table text" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 3: Cursor-aware table edits (Tab, Shift-Tab, Enter, Format)

**Files:**
- Create: `web/src/tables/navigate.ts`
- Test: `web/test/tables.navigate.test.ts`

**Interfaces:**
- Consumes: `cellRange`, `columnAt`, `findTableAt`, `insertRow`, `parseTable`, `serializeTable`, `MdTable` from `./md-table`.
- Produces (exact):
```ts
export interface CursorEdit { from: number; to: number; insert: string; anchor: number; head: number }
// from/to/insert replace part of the old text; anchor/head are offsets in the NEW text.
export function tabEdit(text: string, pos: number, dir: 1 | -1): CursorEdit | null;
export function enterEdit(text: string, pos: number): CursorEdit | null;
export function formatEdit(text: string, pos: number): CursorEdit | null;
```
All return `null` when `pos` is not inside a table (the caller then lets the key fall through). Behaviour: Tab selects the next cell's content (caret when empty), re-pads the table; after the last cell it appends a row and puts the caret in its first cell. Shift-Tab goes back; at the very first cell it stays. From the delimiter row, Tab goes to the first body cell and Shift-Tab to the last header cell. Enter moves to the same column one row down and, on the last row, appends a row and puts the caret in the same column. Format keeps the caret in the current cell.

- [ ] **Step 1: Write the failing test**

```ts
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
    const [fenced, fp] = at("```\n| a |\n|---|\n| x" + MARK + " |\n```\n");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/tables.navigate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import {
  cellRange,
  columnAt,
  findTableAt,
  insertRow,
  parseTable,
  serializeTable,
  type MdTable,
} from "./md-table";

export interface CursorEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

interface Ctx {
  original: string;
  start: number;
  end: number;
  eol: string;
  model: MdTable;
  row: number;
  col: number;
  delimiter: boolean;
}

function locate(text: string, pos: number): Ctx | null {
  const parts = text.split("\n");
  let offset = 0;
  let lineIdx = 0;
  while (lineIdx < parts.length - 1 && offset + parts[lineIdx]!.length + 1 <= pos) {
    offset += parts[lineIdx]!.length + 1;
    lineIdx++;
  }
  const clean = parts.map((l) => l.replace(/\r$/, ""));
  const range = findTableAt(clean, lineIdx + 1);
  if (!range) return null;
  const model = parseTable(clean.slice(range.from - 1, range.to));
  if (!model) return null;
  let start = 0;
  for (let i = 0; i < range.from - 1; i++) start += parts[i]!.length + 1;
  const tableParts = parts.slice(range.from - 1, range.to);
  const last = tableParts[tableParts.length - 1]!;
  const end = start + tableParts.join("\n").length - (last.endsWith("\r") ? 1 : 0);
  const rowLine = lineIdx + 1 - range.from;
  return {
    original: text.slice(start, end),
    start,
    end,
    eol: tableParts[0]!.endsWith("\r") ? "\r\n" : "\n",
    model,
    row: rowLine <= 1 ? -1 : rowLine - 2,
    col: Math.min(columnAt(clean[lineIdx]!, pos - offset), model.header.length - 1),
    delimiter: rowLine === 1,
  };
}

function finish(ctx: Ctx, model: MdTable, target: { row: number; col: number }, select: boolean): CursorEdit {
  const lines = serializeTable(model);
  const insert = lines.join(ctx.eol);
  const idx = target.row < 0 ? 0 : target.row + 2;
  let base = ctx.start;
  for (let i = 0; i < idx; i++) base += lines[i]!.length + ctx.eol.length;
  const r = cellRange(lines[idx]!, target.col) ?? { from: 0, to: 0 };
  const anchor = base + r.from;
  const head = select ? base + r.to : anchor;
  if (insert === ctx.original) return { from: ctx.start, to: ctx.start, insert: "", anchor, head };
  return { from: ctx.start, to: ctx.end, insert, anchor, head };
}

export function tabEdit(text: string, pos: number, dir: 1 | -1): CursorEdit | null {
  const ctx = locate(text, pos);
  if (!ctx) return null;
  const width = ctx.model.header.length;
  let { row, col } = ctx;
  if (ctx.delimiter) {
    if (dir > 0) col = width - 1;
    else {
      row = 0;
      col = 0;
    }
  }
  const next = (row + 1) * width + col + dir;
  if (next < 0) return finish(ctx, ctx.model, { row: -1, col: 0 }, true);
  if (next >= (ctx.model.rows.length + 1) * width) {
    const grown = insertRow(ctx.model, ctx.model.rows.length);
    return finish(ctx, grown, { row: ctx.model.rows.length, col: 0 }, false);
  }
  return finish(ctx, ctx.model, { row: Math.floor(next / width) - 1, col: next % width }, true);
}

export function enterEdit(text: string, pos: number): CursorEdit | null {
  const ctx = locate(text, pos);
  if (!ctx) return null;
  if (ctx.row + 1 < ctx.model.rows.length) {
    return finish(ctx, ctx.model, { row: ctx.row + 1, col: ctx.col }, true);
  }
  const grown = insertRow(ctx.model, ctx.model.rows.length);
  return finish(ctx, grown, { row: ctx.model.rows.length, col: ctx.col }, false);
}

export function formatEdit(text: string, pos: number): CursorEdit | null {
  const ctx = locate(text, pos);
  if (!ctx) return null;
  return finish(ctx, ctx.model, { row: ctx.row, col: ctx.col }, false);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/tables.navigate.test.ts`
Expected: PASS. If the "ragged row" test fails on `selected`, the ragged row `| 1 |` is padded to two cells by `parseTable`, so Tab from col 0 selects the empty second cell: `""`. That is the expected value.

- [ ] **Step 5: Commit**

```bash
git add web/src/tables/navigate.ts web/test/tables.navigate.test.ts
git commit -m "feat(web): cursor-aware table edits for Tab, Enter and Format" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 4: CodeMirror keymap, Format command, toolbar button

**Files:**
- Create: `web/src/tables/cm.ts`
- Modify: `web/src/components/Editor.tsx` (import near line 17, extensions list near line 270)
- Modify: `web/src/editor/actions.ts` (append an export)
- Modify: `web/src/components/EditorToolbar.tsx` (import, one button)
- Test: `web/test/tables.cm.test.ts`

**Interfaces:**
- Consumes: `tabEdit`, `enterEdit`, `formatEdit`, `CursorEdit` from `./navigate`; `tableEdit`, `TextEdit` from `./apply`; `LineRange`, `MdTable` from `./md-table`.
- Produces (exact):
```ts
export type ViewLike = Pick<EditorView, "state" | "dispatch">;
export const tableKeymap: Extension;                 // Tab, Shift-Tab, Enter, Mod-Alt-t
export function formatTable(view: ViewLike): boolean;
export function dispatchTableEdit(view: ViewLike, range: LineRange, fn: (t: MdTable) => MdTable): boolean;
```
`dispatchTableEdit` returns `false` when the range is not a table; it dispatches exactly one transaction with `isolateHistory.of("full")` so one undo reverts it.

- [ ] **Step 1: Write the failing test**

`web/test/tables.cm.test.ts` drives the commands with a view stub built on a bare `EditorState` (no DOM needed):

```ts
import { describe, expect, test } from "bun:test";
import { EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { history, undo } from "@codemirror/commands";
import { dispatchTableEdit, formatTable } from "../src/tables/cm";
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/tables.cm.test.ts`
Expected: FAIL, module `../src/tables/cm` not found.

- [ ] **Step 3: Write minimal implementation**

`web/src/tables/cm.ts`:

```ts
import { completionStatus } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { tableEdit } from "./apply";
import type { LineRange, MdTable } from "./md-table";
import { enterEdit, formatEdit, tabEdit, type CursorEdit } from "./navigate";

export type ViewLike = Pick<EditorView, "state" | "dispatch">;

function runCursorEdit(view: ViewLike, make: (text: string, pos: number) => CursorEdit | null): boolean {
  const sel = view.state.selection.main;
  if (!sel.empty || completionStatus(view.state) !== null) return false;
  const edit = make(view.state.doc.toString(), sel.head);
  if (!edit) return false;
  const changed = edit.from !== edit.to || edit.insert !== "";
  view.dispatch({
    changes: changed ? { from: edit.from, to: edit.to, insert: edit.insert } : undefined,
    selection: { anchor: edit.anchor, head: edit.head },
    scrollIntoView: true,
    userEvent: "input.table",
  });
  return true;
}

export const formatTable = (view: ViewLike): boolean => runCursorEdit(view, formatEdit);

export const tableKeymap: Extension = keymap.of([
  { key: "Tab", run: (v) => runCursorEdit(v, (t, p) => tabEdit(t, p, 1)) },
  { key: "Shift-Tab", run: (v) => runCursorEdit(v, (t, p) => tabEdit(t, p, -1)) },
  { key: "Enter", run: (v) => runCursorEdit(v, enterEdit) },
  { key: "Mod-Alt-t", run: formatTable },
]);

export function dispatchTableEdit(
  view: ViewLike,
  range: LineRange,
  fn: (t: MdTable) => MdTable,
): boolean {
  const edit = tableEdit(view.state.doc.toString(), range, fn);
  if (!edit) return false;
  if (edit.from === edit.to && edit.insert === "") return true;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    userEvent: "input.table",
    annotations: isolateHistory.of("full"),
  });
  return true;
}
```

Edit `web/src/components/Editor.tsx`: add the import after the `isMediaName` import line:

```ts
import { tableKeymap } from "../tables/cm";
```

and in `baseExtensions`, put `tableKeymap` immediately before the existing `keymap.of([...defaultKeymap, ...])` entry:

```ts
      tableKeymap,
      keymap.of([
        ...defaultKeymap,
```

Append to `web/src/editor/actions.ts`:

```ts
export function formatTableAction(view: EditorView) {
  formatTable(view);
}
```

and add `import { formatTable } from "../tables/cm";` at the top of that file (below its existing imports).

Edit `web/src/components/EditorToolbar.tsx`: add `ViewHorizontalIcon` to the `@radix-ui/react-icons` import list, add `formatTableAction` to the existing `../editor/actions` import list, and add the button right after the `Table` button:

```tsx
        {btn(<ViewHorizontalIcon />, "Format table (Mod-Alt-T)", apply(formatTableAction))}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd web && bun test test/tables.cm.test.ts && bun run typecheck`
Expected: PASS, typecheck clean. If `tsc` rejects passing `ViewLike` handlers to `keymap.of`, change the `run` lambdas to `(v: EditorView) => ...` (EditorView is assignable to `ViewLike`).

- [ ] **Step 5: Manual check of today's Tab behaviour is preserved**

Run `bun run dev` from the repo root against a scratch vault (see Task 10, step 1), open a note, press Tab on a plain paragraph line: the line indents as before. Press Tab inside a table: caret moves to the next cell.

- [ ] **Step 6: Commit**

```bash
git add web/src/tables/cm.ts web/src/components/Editor.tsx web/src/editor/actions.ts web/src/components/EditorToolbar.tsx web/test/tables.cm.test.ts
git commit -m "feat(web): Tab, Enter and Format table keymap scoped to table lines" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 5: Renderer tags tables with their line range

**Files:**
- Modify: `web/src/renderer/plugins/sourcepos.ts`
- Test: `web/test/render.table-source.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: every top-level `<table>` in `renderMarkdown(...).html` carries `data-source-line="<first line>"` and `data-source-end="<last line>"`, both 1-based and absolute (frontmatter offset included). Other blocks keep only `data-source-line`. `previewSchema` is unchanged (`data*` already allowed).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/renderer/render";

const opts = { resolveWikilink: () => null, isMediaTarget: () => false, buildMediaUrl: () => "" };
const TABLE = "| a | b |\n|---|---|\n| 1 | 2 |\n";

describe("table source range", () => {
  test("a top-level table carries first and last line", () => {
    const { html } = renderMarkdown(`intro\n\n${TABLE}\nafter\n`, opts);
    expect(html).toContain('<table data-source-line="3" data-source-end="5">');
  });

  test("frontmatter lines are counted", () => {
    const { html } = renderMarkdown(`---\ntitle: x\n---\n\n${TABLE}`, opts);
    expect(html).toContain('data-source-line="5" data-source-end="7"');
  });

  test("CRLF content gives the same range", () => {
    const { html } = renderMarkdown(`intro\r\n\r\n${TABLE.replace(/\n/g, "\r\n")}`, opts);
    expect(html).toContain('data-source-line="3" data-source-end="5"');
  });

  test("the sanitizer keeps both attributes", () => {
    const { html } = renderMarkdown(TABLE, opts);
    expect(html).toMatch(/<table[^>]*data-source-end="3"/);
  });

  test("other blocks get no data-source-end", () => {
    const { html } = renderMarkdown("# h\n\npara\n", opts);
    expect(html).not.toContain("data-source-end");
  });

  test("tables nested in a blockquote are untagged", () => {
    const { html } = renderMarkdown("> | a |\n> |---|\n> | 1 |\n", opts);
    expect(html).toContain("<table>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/render.table-source.test.ts`
Expected: FAIL on the first, second, third and fourth tests (no `data-source-end` yet); the last two already pass.

- [ ] **Step 3: Write minimal implementation**

In `web/src/renderer/plugins/sourcepos.ts` replace the loop body so it reads the end line for tables:

```ts
export const remarkSourcepos: Plugin<[SourceposOptions], Root> = (opts) => (tree) => {
    for (const child of tree.children) {
      if (!TARGET.has(child.type)) continue;
      const pos = (child as { position?: { start: { line: number }; end: { line: number } } }).position;
      const start = pos?.start.line;
      if (start === undefined) continue;
      const data = ((child as { data?: Record<string, unknown> }).data ??= {}) as Record<string, unknown>;
      const props = (data.hProperties ??= {}) as Record<string, unknown>;
      props["data-source-line"] = String(start + opts.lineOffset);
      if (child.type === "table" && pos) props["data-source-end"] = String(pos.end.line + opts.lineOffset);
    }
  };
```

- [ ] **Step 4: Run the whole web suite**

Run: `cd web && bun test`
Expected: PASS, including `render.sanitize*.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add web/src/renderer/plugins/sourcepos.ts web/test/render.table-source.test.ts
git commit -m "feat(web): render tables with data-source-end" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 6: Shared action registry and drag math

**Files:**
- Create: `web/src/tables/table-actions.ts`, `web/src/tables/drag.ts`
- Test: `web/test/tables.actions.test.ts`

**Interfaces:**
- Consumes: `MdTable`, `Align`, `insertRow`, `deleteRow`, `moveRow`, `insertColumn`, `deleteColumn`, `moveColumn`, `setAlign` from `./md-table`.
- Produces (exact):
```ts
// table-actions.ts
export interface CellRef { row: number; col: number }            // row -1 = header
export type ActionGroup = "insert" | "move" | "align" | "delete";
export interface TableAction {
  id: string; label: string; shortLabel: string; group: ActionGroup;
  enabled: (t: MdTable, at: CellRef) => boolean;
  run: (t: MdTable, at: CellRef) => MdTable;
}
export const ACTION_GROUPS: ActionGroup[];
export const TABLE_ACTIONS: TableAction[];
// ids: row-above row-below col-left col-right row-up row-down col-move-left col-move-right
//      align-left align-center align-right delete-row delete-column
// drag.ts
export function boundaryIndex(centers: number[], pos: number): number;   // number of centres before pos
export function moveTarget(from: number, boundary: number): number;      // index in the resulting array
```

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && bun test test/tables.actions.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write minimal implementation**

`web/src/tables/drag.ts`:

```ts
export function boundaryIndex(centers: number[], pos: number): number {
  let b = 0;
  for (const c of centers) if (c < pos) b++;
  return b;
}

export function moveTarget(from: number, boundary: number): number {
  return boundary > from ? boundary - 1 : boundary;
}
```

`web/src/tables/table-actions.ts`:

```ts
import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  setAlign,
  type Align,
  type MdTable,
} from "./md-table";

export interface CellRef {
  row: number;
  col: number;
}
export type ActionGroup = "insert" | "move" | "align" | "delete";
export interface TableAction {
  id: string;
  label: string;
  shortLabel: string;
  group: ActionGroup;
  enabled: (t: MdTable, at: CellRef) => boolean;
  run: (t: MdTable, at: CellRef) => MdTable;
}

export const ACTION_GROUPS: ActionGroup[] = ["insert", "move", "align", "delete"];

const align = (id: string, label: string, short: string, value: Align): TableAction => ({
  id,
  label,
  shortLabel: short,
  group: "align",
  enabled: () => true,
  run: (t, at) => setAlign(t, at.col, value),
});

export const TABLE_ACTIONS: TableAction[] = [
  {
    id: "row-above", label: "Insert row above", shortLabel: "Row above", group: "insert",
    enabled: (_t, at) => at.row >= 0,
    run: (t, at) => insertRow(t, at.row),
  },
  {
    id: "row-below", label: "Insert row below", shortLabel: "Row below", group: "insert",
    enabled: () => true,
    run: (t, at) => insertRow(t, at.row + 1),
  },
  {
    id: "col-left", label: "Insert column left", shortLabel: "Col left", group: "insert",
    enabled: () => true,
    run: (t, at) => insertColumn(t, at.col),
  },
  {
    id: "col-right", label: "Insert column right", shortLabel: "Col right", group: "insert",
    enabled: () => true,
    run: (t, at) => insertColumn(t, at.col + 1),
  },
  {
    id: "row-up", label: "Move row up", shortLabel: "Row up", group: "move",
    enabled: (_t, at) => at.row >= 1,
    run: (t, at) => moveRow(t, at.row, at.row - 1),
  },
  {
    id: "row-down", label: "Move row down", shortLabel: "Row down", group: "move",
    enabled: (t, at) => at.row >= 0 && at.row < t.rows.length - 1,
    run: (t, at) => moveRow(t, at.row, at.row + 1),
  },
  {
    id: "col-move-left", label: "Move column left", shortLabel: "Move left", group: "move",
    enabled: (_t, at) => at.col >= 1,
    run: (t, at) => moveColumn(t, at.col, at.col - 1),
  },
  {
    id: "col-move-right", label: "Move column right", shortLabel: "Move right", group: "move",
    enabled: (t, at) => at.col < t.header.length - 1,
    run: (t, at) => moveColumn(t, at.col, at.col + 1),
  },
  align("align-left", "Align left", "Left", "left"),
  align("align-center", "Align centre", "Centre", "center"),
  align("align-right", "Align right", "Right", "right"),
  {
    id: "delete-row", label: "Delete row", shortLabel: "Del row", group: "delete",
    enabled: (_t, at) => at.row >= 0,
    run: (t, at) => deleteRow(t, at.row),
  },
  {
    id: "delete-column", label: "Delete column", shortLabel: "Del col", group: "delete",
    enabled: (t) => t.header.length > 1,
    run: (t, at) => deleteColumn(t, at.col),
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && bun test test/tables.actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/tables/table-actions.ts web/src/tables/drag.ts web/test/tables.actions.test.ts
git commit -m "feat(web): shared table action registry and drag math" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 7: Preview wiring and inline cell editing

Smallest slice that proves the whole preview path: click a cell, edit its raw text, Enter commits to the editor in one undoable transaction. Hover controls, context menu and the touch bar are added in Tasks 8 and 9 to the same component.

**Files:**
- Create: `web/src/components/TableTools.tsx`, `web/src/styles/tables.css`
- Modify: `web/src/components/Preview.tsx` (props, click handler, return block)
- Modify: `web/src/App.tsx` (imports, handler, prop, css import)
- Modify: `web/src/styles/preview.css` (`.preview` gets `position: relative`)

**Interfaces:**
- Consumes: `readTable`, `tableEdit`, `applyEdit` from `../tables/apply`; `setCell`, `escapeCell`, `LineRange`, `MdTable` from `../tables/md-table`; `dispatchTableEdit` from `../tables/cm`; `useMediaQuery(query: string): boolean` from `../hooks/useMediaQuery`.
- Produces: Preview prop `onEditTable?: (range: LineRange, fn: (t: MdTable) => MdTable) => void`. `TableTools` props:
```ts
interface TableToolsProps {
  scrollerRef: RefObject<HTMLDivElement | null>;   // .preview
  docRef: RefObject<HTMLDivElement | null>;        // .doc
  content: string;
  html: string;
  onEditTable: (range: LineRange, fn: (t: MdTable) => MdTable) => void;
  children: ReactNode;                              // the .doc element
}
```
Selection key: `interface CellSel { line: number; end: number; row: number; col: number }` (row -1 = header). Overlay geometry is measured in a layout effect into state (the DOM for a new `html` is not committed while the component renders).

- [ ] **Step 1: Create `web/src/components/TableTools.tsx` (editing slice)**

```tsx
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { readTable } from "../tables/apply";
import { escapeCell, setCell, type LineRange, type MdTable } from "../tables/md-table";

export interface CellSel {
  line: number;
  end: number;
  row: number;
  col: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Geo {
  table: Box;
  sel: Box | null;
  edit: Box | null;
}

interface TableToolsProps {
  scrollerRef: RefObject<HTMLDivElement | null>;
  docRef: RefObject<HTMLDivElement | null>;
  content: string;
  html: string;
  onEditTable: (range: LineRange, fn: (t: MdTable) => MdTable) => void;
  children: ReactNode;
}

function rectIn(scroller: HTMLElement, el: Element): Box {
  const s = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    left: r.left - s.left + scroller.scrollLeft,
    top: r.top - s.top + scroller.scrollTop,
    width: r.width,
    height: r.height,
  };
}

function liveTables(doc: HTMLElement): HTMLTableElement[] {
  return Array.from(doc.querySelectorAll<HTMLTableElement>("table[data-source-end]")).filter(
    (t) => !t.closest(".embed-body"),
  );
}

function tableByLine(doc: HTMLElement | null, line: number): HTMLTableElement | null {
  if (!doc) return null;
  return liveTables(doc).find((t) => Number(t.dataset.sourceLine) === line) ?? null;
}

function addressOf(target: EventTarget | null): CellSel | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest("td, th");
  const table = cell?.closest<HTMLTableElement>("table[data-source-end]");
  if (!cell || !table || table.closest(".embed-body")) return null;
  const tr = cell.parentElement as HTMLTableRowElement | null;
  const line = Number(table.dataset.sourceLine);
  const end = Number(table.dataset.sourceEnd);
  if (!tr || !Number.isInteger(line) || !Number.isInteger(end)) return null;
  const inHead = tr.parentElement?.tagName === "THEAD";
  return { line, end, row: inHead ? -1 : tr.rowIndex - 1, col: (cell as HTMLTableCellElement).cellIndex };
}

function matchesModel(table: HTMLTableElement, model: MdTable): boolean {
  return (
    model.header.length === (table.rows[0]?.cells.length ?? -1) &&
    model.rows.length === table.rows.length - 1
  );
}

const cellText = (m: MdTable, row: number, col: number): string =>
  (row < 0 ? m.header[col] : m.rows[row]?.[col]) ?? "";

export function TableTools({ scrollerRef, docRef, content, html, onEditTable, children }: TableToolsProps) {
  const [editing, setEditing] = useState<CellSel | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const doc = docRef.current;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    if (scroller) ro.observe(scroller);
    if (doc) ro.observe(doc);
    return () => ro.disconnect();
  }, [scrollerRef, docRef]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const doc = docRef.current;
    const table = editing && doc ? tableByLine(doc, editing.line) : null;
    if (!scroller || !table || !editing) {
      setGeo(null);
      if (editing && !table) setEditing(null);
      return;
    }
    const tr = editing.row < 0 ? table.rows[0] : table.rows[editing.row + 1];
    const cell = tr?.cells[editing.col];
    setGeo({ table: rectIn(scroller, table), sel: null, edit: cell ? rectIn(scroller, cell) : null });
  }, [scrollerRef, docRef, editing, html, tick]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest("a, input, button, summary")) return;
      const addr = addressOf(t);
      if (!addr) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const table = tableByLine(doc, addr.line);
      const model = readTable(content, { from: addr.line, to: addr.end });
      if (!table || !model || !matchesModel(table, model)) return;
      doneRef.current = false;
      setEditing(addr);
    };
    doc.addEventListener("click", onClick);
    return () => doc.removeEventListener("click", onClick);
  }, [docRef, content, html]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const model = editing ? readTable(content, { from: editing.line, to: editing.end }) : null;

  const commit = (value: string) => {
    if (!editing || !model || doneRef.current) return;
    doneRef.current = true;
    const next = escapeCell(value);
    const target = editing;
    setEditing(null);
    if (next === cellText(model, target.row, target.col)) return;
    onEditTable({ from: target.line, to: target.end }, (t) => setCell(t, target.row, target.col, next));
  };

  const cancel = () => {
    doneRef.current = true;
    setEditing(null);
  };

  return (
    <>
      {children}
      <div className="table-tools">
        {editing && model && geo?.edit ? (
          <input
            ref={inputRef}
            className="tt-input"
            aria-label="Edit table cell"
            defaultValue={cellText(model, editing.row, editing.col)}
            style={{ left: geo.edit.left, top: geo.edit.top, width: geo.edit.width, minHeight: geo.edit.height }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={(e) => commit(e.currentTarget.value)}
          />
        ) : null}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Create `web/src/styles/tables.css`**

```css
.table-tools {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  z-index: 2;
}
.table-tools > * {
  position: absolute;
}

.tt-input {
  box-sizing: border-box;
  padding: 6px 10px;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-1);
  background: var(--bg-surface);
  border: 2px solid var(--accent);
  border-radius: var(--radius-1);
  outline: none;
}
@media (pointer: coarse) {
  .tt-input {
    font-size: 16px;
    min-height: 40px;
  }
}

@media (hover: hover) {
  .preview .doc table[data-source-end] td,
  .preview .doc table[data-source-end] th {
    cursor: text;
  }
}
```

In `web/src/styles/preview.css` change the first rule to:

```css
.preview {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--space-5) var(--space-5) var(--space-7);
}
```

- [ ] **Step 3: Modify `Preview.tsx`**

Add imports at the top:

```tsx
import { TableTools } from "./TableTools";
import type { LineRange, MdTable } from "../tables/md-table";
```

Add to `PreviewProps`:

```ts
  onEditTable?: (range: LineRange, fn: (t: MdTable) => MdTable) => void;
```

Add `onEditTable` to the destructured props of the component.

In the click handler, immediately before the comment line that starts with `// climb again` (search for `climb again`), insert:

```tsx
      if (onEditTable && (e.target as HTMLElement | null)?.closest?.("table[data-source-end]")) return;
```

and add `onEditTable` to that effect's dependency array (`[onOpenNote, onMissingNote, onOpenTag, onSelectLine, onEditTable, html]`).

Replace the final `return (...)` of `Preview` with:

```tsx
  const docEl = (
    <div className="doc" ref={docRef}>
      {frontmatterError ? (
        <div className="frontmatter-error">frontmatter: {frontmatterError}</div>
      ) : null}
      {frontmatter && Object.keys(frontmatter).length > 0 ? (
        <PropsRender data={frontmatter} />
      ) : null}
      {content.trim() === "" ? (
        notePath ? <p className="muted">Empty note</p> : null
      ) : (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown runs hast-util-sanitize with previewSchema
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );

  return (
    <div className="preview scroll" ref={ref}>
      {onEditTable ? (
        <TableTools scrollerRef={ref} docRef={docRef} content={content} html={html} onEditTable={onEditTable}>
          {docEl}
        </TableTools>
      ) : (
        docEl
      )}
    </div>
  );
```

- [ ] **Step 4: Modify `App.tsx`**

Add imports near the other component imports and the css imports (next to `import "./styles/preview.css";`):

```tsx
import "./styles/tables.css";
import { applyEdit, tableEdit } from "./tables/apply";
import { dispatchTableEdit } from "./tables/cm";
import type { LineRange, MdTable } from "./tables/md-table";
```

Directly after the `onPreviewSelectLine` callback (ends near line 352) add:

```tsx
  const onEditTable = useCallback((range: LineRange, fn: (t: MdTable) => MdTable) => {
    const v = editorViewRef.current;
    if (v) {
      dispatchTableEdit(v, range, fn);
      return;
    }
    setContent((cur) => {
      const edit = tableEdit(cur, range, fn);
      return edit ? applyEdit(cur, edit) : cur;
    });
  }, []);
```

On the `<Preview ... />` element add `onEditTable={path ? onEditTable : undefined}` after `onSelectLine={onPreviewSelectLine}`.

- [ ] **Step 5: Typecheck, build, tests**

Run: `bun run --cwd web build && cd web && bun test`
Expected: build succeeds, tests PASS.

- [ ] **Step 6: Manual check**

Start the dev stack (Task 10 step 1). Open a note containing a table in Both mode. Click a cell: an input with a 2px accent border appears over it containing the raw text; type, press Enter: the cell changes in both panes. Cmd/Ctrl+Z in the editor reverts it in one step. Escape cancels. Click a wikilink inside a cell: it navigates, no input. The editor does not steal focus while the input is open.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/TableTools.tsx web/src/components/Preview.tsx web/src/App.tsx web/src/styles/tables.css web/src/styles/preview.css
git commit -m "feat(web): click a table cell in the preview to edit its source" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 8: Hover `+` buttons and drag handles (desktop)

**Files:**
- Modify: `web/src/components/TableTools.tsx`
- Modify: `web/src/styles/tables.css`

**Interfaces:**
- Consumes: `insertColumn`, `insertRow`, `moveColumn`, `moveRow` from `../tables/md-table`; `boundaryIndex`, `moveTarget` from `../tables/drag`; `useMediaQuery` from `../hooks/useMediaQuery`; `PlusIcon` from `@radix-ui/react-icons`.
- Produces: no new exports. Behaviour: with a mouse over a table the overlay shows a right-edge strip `+` (appends a column), a bottom-edge strip `+` (appends a row), a grip above each header cell (drag to reorder columns) and a grip left of each body row (drag to reorder rows); a 2px accent line shows the drop boundary. Hidden entirely when `(hover: none)`.

- [ ] **Step 1: Extend `TableTools.tsx`**

Add imports:

```tsx
import type { PointerEvent as ReactPointerEvent } from "react";
import { PlusIcon } from "@radix-ui/react-icons";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { boundaryIndex, moveTarget } from "../tables/drag";
import { insertColumn, insertRow, moveColumn, moveRow } from "../tables/md-table";
```

(merge the `md-table` import with the existing one: `escapeCell, insertColumn, insertRow, moveColumn, moveRow, setCell, type LineRange, type MdTable`; merge the `react` imports.)

Add types and state next to the existing ones:

```tsx
interface TableKey {
  line: number;
  end: number;
}

interface DragState extends TableKey {
  kind: "row" | "col";
  from: number;
  boundary: number;
}
```

Replace `interface Geo` with:

```tsx
interface Geo {
  table: Box;
  head: Box[];
  body: Box[];
  edit: Box | null;
  limitRight: number;
}
```

Inside the component add:

```tsx
  const coarse = useMediaQuery("(hover: none)");
  const [hover, setHover] = useState<TableKey | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
```

Add the hover listener effect:

```tsx
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let timer = 0;
    const clearSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHover(null), 160);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const t = e.target as Element | null;
      if (t?.closest(".table-tools")) {
        window.clearTimeout(timer);
        return;
      }
      const table = t?.closest<HTMLTableElement>("table[data-source-end]");
      if (table && !table.closest(".embed-body")) {
        window.clearTimeout(timer);
        const next = { line: Number(table.dataset.sourceLine), end: Number(table.dataset.sourceEnd) };
        setHover((h) => (h && h.line === next.line && h.end === next.end ? h : next));
        return;
      }
      clearSoon();
    };
    scroller.addEventListener("pointermove", onMove);
    scroller.addEventListener("pointerleave", clearSoon);
    return () => {
      window.clearTimeout(timer);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerleave", clearSoon);
    };
  }, [scrollerRef]);
```

Replace the geometry layout effect with the version that measures the active table (editing, drag or hover, in that priority):

```tsx
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const doc = docRef.current;
    const key: TableKey | null = editing ?? drag ?? (coarse ? null : hover);
    const table = key && doc ? tableByLine(doc, key.line) : null;
    if (!scroller || !table) {
      setGeo(null);
      if (editing && !table) setEditing(null);
      return;
    }
    let edit: Box | null = null;
    if (editing) {
      const tr = editing.row < 0 ? table.rows[0] : table.rows[editing.row + 1];
      const cell = tr?.cells[editing.col];
      edit = cell ? rectIn(scroller, cell) : null;
    }
    setGeo({
      table: rectIn(scroller, table),
      head: Array.from(table.rows[0]?.cells ?? [], (c) => rectIn(scroller, c)),
      body: Array.from(table.rows).slice(1).map((r) => rectIn(scroller, r)),
      edit,
      limitRight: scroller.clientWidth + scroller.scrollLeft - 18,
    });
  }, [scrollerRef, docRef, editing, drag?.line, hover, coarse, html, tick]);
```

Add the drag and action handlers before the `return`:

```tsx
  const edit = (key: TableKey, fn: (t: MdTable) => MdTable) => onEditTable({ from: key.line, to: key.end }, fn);

  const startDrag = (e: ReactPointerEvent<HTMLElement>, key: TableKey, kind: "row" | "col", from: number) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ ...key, kind, from, boundary: from });
  };

  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const scroller = scrollerRef.current;
    if (!drag || !geo || !scroller) return;
    const s = scroller.getBoundingClientRect();
    const boundary =
      drag.kind === "col"
        ? boundaryIndex(geo.head.map((c) => c.left + c.width / 2), e.clientX - s.left + scroller.scrollLeft)
        : boundaryIndex(geo.body.map((r) => r.top + r.height / 2), e.clientY - s.top + scroller.scrollTop);
    if (boundary !== drag.boundary) setDrag({ ...drag, boundary });
  };

  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    const to = moveTarget(d.from, d.boundary);
    setDrag(null);
    if (to !== d.from) {
      edit(d, (t) => (d.kind === "col" ? moveColumn(t, d.from, to) : moveRow(t, d.from, to)));
    }
  };
```

Inside `<div className="table-tools">`, before the `<input>`, render the hover controls:

```tsx
        {!coarse && geo && !editing && (hover || drag) ? (
          <HoverControls
            geo={geo}
            drag={drag}
            onAddColumn={() => hover && edit(hover, (t) => insertColumn(t, t.header.length))}
            onAddRow={() => hover && edit(hover, (t) => insertRow(t, t.rows.length))}
            onGripDown={(e, kind, from) => (hover ?? drag) && startDrag(e, (hover ?? drag)!, kind, from)}
            onGripMove={moveDrag}
            onGripUp={endDrag}
            onGripCancel={() => setDrag(null)}
          />
        ) : null}
```

Add the component at the bottom of the file:

```tsx
interface HoverControlsProps {
  geo: Geo;
  drag: DragState | null;
  onAddColumn: () => void;
  onAddRow: () => void;
  onGripDown: (e: ReactPointerEvent<HTMLElement>, kind: "row" | "col", from: number) => void;
  onGripMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onGripUp: () => void;
  onGripCancel: () => void;
}

function HoverControls({ geo, drag, onAddColumn, onAddRow, onGripDown, onGripMove, onGripUp, onGripCancel }: HoverControlsProps) {
  const { table, head, body } = geo;
  const gripProps = (kind: "row" | "col", i: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onGripDown(e, kind, i),
    onPointerMove: onGripMove,
    onPointerUp: onGripUp,
    onPointerCancel: onGripCancel,
  });
  let drop: { left: number; top: number; width: number; height: number } | null = null;
  if (drag?.kind === "col") {
    const at = head[drag.boundary];
    const last = head[head.length - 1];
    const x = at ? at.left : last ? last.left + last.width : table.left;
    drop = { left: x - 1, top: table.top, width: 2, height: table.height };
  } else if (drag?.kind === "row") {
    const at = body[drag.boundary];
    const last = body[body.length - 1];
    const y = at ? at.top : last ? last.top + last.height : table.top;
    drop = { left: table.left, top: y - 1, width: table.width, height: 2 };
  }
  return (
    <>
      <button
        type="button"
        className="tt-add tt-add-col"
        aria-label="Add column"
        style={{ left: Math.min(table.left + table.width, geo.limitRight), top: table.top, height: table.height }}
        onClick={onAddColumn}
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        className="tt-add tt-add-row"
        aria-label="Add row"
        style={{ left: table.left, top: table.top + table.height, width: table.width }}
        onClick={onAddRow}
      >
        <PlusIcon />
      </button>
      {head.map((c, i) => (
        <div
          key={`c${i}`}
          className="tt-grip tt-grip-col"
          role="presentation"
          style={{ left: c.left + c.width / 2 - 12, top: table.top - 11 }}
          {...gripProps("col", i)}
        />
      ))}
      {body.map((r, i) => (
        <div
          key={`r${i}`}
          className="tt-grip tt-grip-row"
          role="presentation"
          style={{ left: table.left - 11, top: r.top + r.height / 2 - 12 }}
          {...gripProps("row", i)}
        />
      ))}
      {drop ? <div className="tt-drop" style={drop} /> : null}
    </>
  );
}
```

- [ ] **Step 2: Append the styles to `tables.css`**

```css
.tt-add {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  width: 18px;
  color: var(--text-3);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-1);
  cursor: pointer;
}
.tt-add-row {
  height: 18px;
}
.tt-add:hover,
.tt-add:focus-visible {
  color: var(--text-1);
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.tt-grip {
  width: 24px;
  height: 8px;
  background: var(--border-strong);
  border-radius: 4px;
  opacity: 0.6;
  cursor: grab;
  touch-action: none;
}
.tt-grip-row {
  width: 8px;
  height: 24px;
}
.tt-grip:hover,
.tt-grip:active {
  background: var(--accent);
  opacity: 1;
}
.tt-grip:active {
  cursor: grabbing;
}

.tt-drop {
  background: var(--accent);
  pointer-events: none;
}

@media (hover: none) {
  .tt-add,
  .tt-grip,
  .tt-drop {
    display: none;
  }
}
```

- [ ] **Step 3: Build and test**

Run: `bun run --cwd web build && cd web && bun test`
Expected: build succeeds, tests PASS.

- [ ] **Step 4: Manual check**

Desktop, Both mode: hover a table, a thin `+` strip appears on the right edge and bottom edge with no gap from the table, so moving onto it keeps it visible. Click right `+`: a column is appended in both panes. Click bottom `+`: a row is appended. Drag a grip above a header cell sideways: the accent line follows between columns; release: the column (header, alignment, cells) moved. Same for row grips. One Cmd/Ctrl+Z reverts each. Narrow the window so the table fills the pane: the right `+` stays inside the viewport (clamped by `limitRight`).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TableTools.tsx web/src/styles/tables.css
git commit -m "feat(web): hover add buttons and drag handles for preview tables" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 9: Context menu and touch action bar

**Files:**
- Modify: `web/src/components/TableTools.tsx`
- Modify: `web/src/styles/tables.css`

**Interfaces:**
- Consumes: `TABLE_ACTIONS`, `ACTION_GROUPS`, `TableAction`, `CellRef` from `../tables/table-actions`; `ContextMenu`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuSeparator`, `ContextMenuTrigger` from `./ui/context-menu`; `Cross2Icon` from `@radix-ui/react-icons`.
- Produces: right click (or long press) in an editable table cell opens a menu with every registry action, disabled per `enabled`. At `(hover: none)` a tap on a cell selects it (accent outline) and shows a sticky bottom action bar with an "Edit cell" button, every registry action and a close button; tapping the selected cell again opens the inline editor. Outside editable table cells the native context menu is untouched.

- [ ] **Step 1: Extend `TableTools.tsx`**

Add imports (merge with existing):

```tsx
import { Fragment } from "react";
import { Cross2Icon } from "@radix-ui/react-icons";
import { ACTION_GROUPS, TABLE_ACTIONS, type TableAction } from "../tables/table-actions";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
```

Extend `Geo` with `sel: Box | null` (re-add) and add state:

```tsx
  const [sel, setSel] = useState<CellSel | null>(null);
  const [ctx, setCtx] = useState<CellSel | null>(null);
```

In the layout effect change the key to `editing ?? drag ?? sel ?? (coarse ? null : hover)`, and compute both boxes with a shared helper:

```tsx
    const cellBox = (c: CellSel | null): Box | null => {
      if (!c || c.line !== key?.line) return null;
      const tr = c.row < 0 ? table.rows[0] : table.rows[c.row + 1];
      const cell = tr?.cells[c.col];
      return cell ? rectIn(scroller, cell) : null;
    };
```

then `edit: cellBox(editing), sel: cellBox(sel)` in the `setGeo` call (remove the hand-written `edit` block), add `sel` to the dependency array, and when `key` is set from a stale `sel` whose table vanished (`!table`) also call `setSel(null)`.

Replace the click effect body so touch selects first:

```tsx
      doneRef.current = false;
      if (coarse) {
        const same = sel && sel.line === addr.line && sel.row === addr.row && sel.col === addr.col;
        if (same) setEditing(addr);
        else setSel(addr);
        return;
      }
      setEditing(addr);
```

and add `coarse, sel` to that effect's dependencies.

Add the action runner, menu state and touch model before `return`:

```tsx
  const run = (target: CellSel, a: TableAction) =>
    onEditTable({ from: target.line, to: target.end }, (t) => (a.enabled(t, target) ? a.run(t, target) : t));

  const ctxModel = ctx ? readTable(content, { from: ctx.line, to: ctx.end }) : null;
  const selModel = sel ? readTable(content, { from: sel.line, to: sel.end }) : null;

  const onPointerDownCapture = (e: ReactPointerEvent<HTMLElement>) => {
    const addr = addressOf(e.target);
    const table = addr ? tableByLine(docRef.current, addr.line) : null;
    const m = addr ? readTable(content, { from: addr.line, to: addr.end }) : null;
    setCtx(addr && table && m && matchesModel(table, m) ? addr : null);
  };
```

Replace `{children}` in the returned fragment with:

```tsx
      <ContextMenu>
        <ContextMenuTrigger asChild disabled={!ctx || !ctxModel} onPointerDownCapture={onPointerDownCapture}>
          {children}
        </ContextMenuTrigger>
        {ctx && ctxModel ? (
          <ContextMenuContent>
            {ACTION_GROUPS.map((g, gi) => (
              <Fragment key={g}>
                {gi > 0 ? <ContextMenuSeparator /> : null}
                {TABLE_ACTIONS.filter((a) => a.group === g).map((a) => (
                  <ContextMenuItem key={a.id} disabled={!a.enabled(ctxModel, ctx)} onSelect={() => run(ctx, a)}>
                    {a.label}
                  </ContextMenuItem>
                ))}
              </Fragment>
            ))}
          </ContextMenuContent>
        ) : null}
      </ContextMenu>
```

Inside `.table-tools` add the selection outline:

```tsx
        {coarse && geo?.sel ? (
          <div
            className="tt-cell-sel"
            style={{ left: geo.sel.left, top: geo.sel.top, width: geo.sel.width, height: geo.sel.height }}
          />
        ) : null}
```

After the `.table-tools` div add the bar:

```tsx
      {coarse && sel && selModel ? (
        <div className="table-actionbar" role="toolbar" aria-label="Table actions">
          <button
            type="button"
            onClick={() => {
              doneRef.current = false;
              setEditing(sel);
            }}
          >
            Edit cell
          </button>
          {TABLE_ACTIONS.map((a) => (
            <button key={a.id} type="button" disabled={!a.enabled(selModel, sel)} onClick={() => run(sel, a)}>
              {a.shortLabel}
            </button>
          ))}
          <button type="button" aria-label="Close table actions" onClick={() => setSel(null)}>
            <Cross2Icon />
          </button>
        </div>
      ) : null}
```

Note: clamp the selection after an action that shrinks the table. Add a layout effect:

```tsx
  useLayoutEffect(() => {
    if (!sel || !selModel) return;
    const row = Math.min(sel.row, selModel.rows.length - 1);
    const col = Math.min(sel.col, selModel.header.length - 1);
    if (row !== sel.row || col !== sel.col) setSel({ ...sel, row, col });
  }, [sel, selModel]);
```

- [ ] **Step 2: Append the styles**

```css
.tt-cell-sel {
  border: 2px solid var(--accent);
  border-radius: 2px;
  box-sizing: border-box;
  pointer-events: none;
}

.table-actionbar {
  position: sticky;
  bottom: var(--space-3);
  display: flex;
  gap: 4px;
  width: max-content;
  max-width: 100%;
  margin: var(--space-3) auto 0;
  padding: 6px;
  overflow-x: auto;
  color: var(--text-1);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-3);
  z-index: 3;
}
.table-actionbar button {
  flex: none;
  min-width: 40px;
  min-height: 40px;
  padding: 0 10px;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-2);
  background: transparent;
  border: 0;
  border-radius: var(--radius-2);
}
.table-actionbar button:active:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-1);
}
.table-actionbar button:disabled {
  color: var(--text-4);
}
```

- [ ] **Step 3: Build and test**

Run: `bun run --cwd web build && cd web && bun test`
Expected: PASS.

- [ ] **Step 4: Manual check and contingency**

Desktop: right click a body cell: a menu with 13 items in four groups; "Insert row above" is disabled on a header cell; each item changes the table in both panes; one undo reverts each. Right click on ordinary text: the native browser menu appears. If right click inside a cell still shows the native menu, the `disabled` prop was stale at `contextmenu` time: confirm `onPointerDownCapture` runs (add a temporary `console.log`), and if React batching is the cause replace the `ctx` state with a ref plus a `useSyncExternalStore`-free `forceRender`. Touch (Chrome device emulation, iPhone preset): tap a cell, outline and bar appear; "Row below" adds a row; tap the outlined cell again, the 16px input appears; the bar scrolls sideways and every button is 40px tall.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/TableTools.tsx web/src/styles/tables.css
git commit -m "feat(web): table context menu and touch action bar" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 10: End to end check with screenshots

**Files:**
- No repo changes. A throwaway script and scratch vault live in `$TMPDIR/brainmd-tables-e2e` (outside the repo).

**Interfaces:**
- Consumes: the running dev stack (web `:5173`, server `:3000`).
- Produces: pass/fail output and screenshots `desktop-hover.png`, `desktop-menu.png`, `mobile-bar.png` in the scratch folder.

- [ ] **Step 1: Prepare a scratch vault and start the dev stack**

```bash
export E2E="${TMPDIR:-/tmp}/brainmd-tables-e2e"
mkdir -p "$E2E/vault" && cd "$E2E"
printf '# T\n\n| Name | Qty |\n|---|---:|\n| apple | 3 |\n| kiwi | 12 |\n' > vault/t.md
cd <repo-root> && VAULT_DIR="$E2E/vault" bun run dev
```

Run the last command in a second terminal or in the background and wait until `http://localhost:5173` answers.

- [ ] **Step 2: Write the script**

`$E2E/e2e.mjs`:

```js
import { chromium, devices } from "playwright";

const base = "http://localhost:5173";
const out = process.env.E2E;
const fail = (m) => { console.error("FAIL", m); process.exitCode = 1; };
const eq = (got, want, m) => (got === want ? console.log("ok", m) : fail(`${m}: got ${got}, want ${want}`));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`${base}/#/note/t.md`);
await page.waitForSelector(".preview table[data-source-end]");
const editorText = () => page.locator(".cm-content").innerText();

await page.hover(".preview table");
await page.screenshot({ path: `${out}/desktop-hover.png` });
await page.click(".tt-add-col");
eq(await page.locator(".preview table th").count(), 3, "add column from the right edge +");

await page.hover(".preview table");
await page.click(".tt-add-row");
eq(await page.locator(".preview table tbody tr").count(), 3, "add row from the bottom edge +");

await page.click(".preview table tbody tr:first-child td:first-child");
await page.fill(".tt-input", "pear | green");
await page.press(".tt-input", "Enter");
await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent?.includes("pear \\| green"));
console.log("ok inline edit escapes the pipe");

await page.hover(".preview table");
const grip = page.locator(".tt-grip-col").first();
const box = await grip.boundingBox();
const lastCell = await page.locator(".preview table th").last().boundingBox();
await page.mouse.move(box.x + 12, box.y + 4);
await page.mouse.down();
await page.mouse.move(lastCell.x + lastCell.width - 4, box.y + 4, { steps: 8 });
await page.mouse.up();
eq(await page.locator(".preview table th").last().innerText(), "Name", "drag first column to the end");

await page.click(".cm-content");
await page.keyboard.press("Control+z");
eq(await page.locator(".preview table th").last().innerText(), "Qty", "one undo reverts the column move");

await page.click(".preview table tbody tr:first-child td:nth-child(2)", { button: "right" });
await page.screenshot({ path: `${out}/desktop-menu.png` });
await page.getByRole("menuitem", { name: "Delete row" }).click();
eq(await page.locator(".preview table tbody tr").count(), 2, "context menu delete row");

await page.click(".cm-content");
await page.keyboard.press("Control+End");
await page.keyboard.press("Tab");
console.log("editor Tab outside a table still indents:", JSON.stringify((await editorText()).slice(-20)));

const phone = await browser.newContext({ ...devices["iPhone 13"] });
const m = await phone.newPage();
await m.goto(`${base}/#/note/t.md`);
await m.getByRole("tab", { name: /Preview/ }).click();
await m.waitForSelector(".preview table[data-source-end]");
await m.tap(".preview table tbody tr:first-child td:first-child");
await m.waitForSelector(".table-actionbar");
eq(await m.locator(".tt-grip").count(), 0, "no drag handles at hover none");
const h = await m.locator(".table-actionbar button").first().boundingBox();
eq(h.height >= 40, true, "touch targets are at least 40px");
const before = await m.locator(".preview table tbody tr").count();
await m.getByRole("button", { name: "Row below" }).tap();
eq(await m.locator(".preview table tbody tr").count(), before + 1, "touch bar inserts a row");
await m.screenshot({ path: `${out}/mobile-bar.png` });

await browser.close();
```

- [ ] **Step 3: Install Playwright in the scratch folder only and run**

```bash
cd "$E2E" && bun add playwright && bunx playwright install chromium && bun e2e.mjs
```

Expected: every line starts with `ok`, no `FAIL`. Do not add Playwright to the repo.

- [ ] **Step 4: Look at the screenshots**

Open the three PNGs. Check: the `+` strips and grips are quiet (borders and greys, accent only on hover), the menu uses the app's menu styling, the mobile bar is readable and does not cover the selected cell for a short table. Fix styling in `tables.css` if not, rebuild, rerun.

- [ ] **Step 5: Clean up**

Stop the dev stack. Leave `$E2E` in place (outside the repo); it is not committed.

---

### Task 11: Docs

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: CHANGELOG**

Insert above `## 0.9.0 - 2026-11-18`:

```markdown
## Unreleased

### Added

- **Table editing.** In the editor, Tab and Shift-Tab move between cells and re-pad the table, Enter moves down a row and adds one at the end, and Mod-Alt-T (or the toolbar button) formats the table under the cursor. In the preview, click a cell to edit its source, hover a table for `+` buttons and drag handles, right click for insert, delete, move and align actions. On touch screens a tap selects a cell and shows the same actions in a bar. Every action is one undo step. Tables stay plain GFM pipe tables.
```

- [ ] **Step 2: README**

In `README.md`, in the section `### Editor + preview`, add this paragraph directly before the line `![Editor + preview, sidebar with backlinks](docs/img/project-with-sidebar.png)`:

```markdown
**Tables.** Pipe tables are edited visually or from the keyboard and always
stay plain Markdown. In the editor, <kbd>Tab</kbd> / <kbd>Shift-Tab</kbd> move
between cells and re-pad the table, <kbd>Enter</kbd> moves down (and adds a
row at the end), <kbd>Mod</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> formats it. In the
preview, click a cell to edit it, use the `+` on the right and bottom edge to
add a column or row, drag the grips to reorder, and right click for insert,
delete, move and align. On a phone, tap a cell for the action bar. A literal
pipe inside a cell, including inside code or a `[[link|alias]]`, must be
written `\|`, as GFM requires.
```

- [ ] **Step 3: Scan for em dashes and commit**

Run: `git diff --cached -U0 | grep -n "$(printf '\xe2\x80\x94')" || echo "no em dash"` after staging, then:

```bash
git add CHANGELOG.md README.md
git commit -m "docs: table editing" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

- [ ] **Step 4: Final check**

Run: `bun run --cwd web build && cd web && bun test` and `git diff main --stat | cat`, then scan all new files: `grep -rn "$(printf '\xe2\x80\x94')" web/src/tables web/src/components/TableTools.tsx web/src/styles/tables.css web/test/tables.* web/test/render.table-source.test.ts docs/plans/2026-11-26-plan-3-tables.md || echo clean`. Expected: build and tests green, `clean`.

---

## Self-Review

**Spec coverage (Phase 3, Principles, Out of scope):**
- Pure module with parse, padded serialise, escaped pipes, ragged rows, optional outer pipes, all operations, `findTableAt`: Task 1 (inline-code pipe handling follows the renderer, finding 1).
- Editor keymap (Tab, Shift-Tab, Enter, Format table), scoped to table lines, Tab unchanged elsewhere: Tasks 3, 4 (finding 6).
- Tables carry `data-source-line` and `data-source-end`, allowed by the sanitize schema: Task 5 (finding 4).
- Preview hover `+`, drag handles, context menu with all listed actions, click to edit inline: Tasks 7, 8, 9.
- Touch: tap selects, action bar with the same actions, drag handles hidden: Task 9 (and `hover: none` CSS in Task 8).
- One CodeMirror transaction through `editorViewRef`, else `setContent`; one undo step: Tasks 2, 4, 7 (App `onEditTable`), tested with the stub view in Task 4.
- No storage change, no new dependency, quiet tokens only, 40px touch targets: Global Constraints, Tasks 8, 9, verified in Task 10.
- Principles "files stay the truth", "every write is a normal note write": edits go through the editor document or `content` state, so autosave, git attribution and conflict protection apply unchanged.

**Placeholder scan:** no TBD or "handle edge cases" steps; every code step carries the code.

**Type consistency:** `LineRange`, `MdTable`, `Align` defined once in `md-table.ts`; `TextEdit` in `apply.ts`; `CursorEdit` in `navigate.ts`; `ViewLike`, `dispatchTableEdit`, `formatTable`, `tableKeymap` in `cm.ts`; `CellRef` (`{row, col}`) is structurally satisfied by `CellSel` (`{line, end, row, col}`) in Tasks 8 and 9; `TableAction.shortLabel` introduced in Task 6 and used in Task 9; `onEditTable` signature identical in `TableToolsProps`, `PreviewProps` and `App`. `Geo` is redefined in Tasks 8 and 9 on purpose (each step lists the full new shape).

**Known limits (stated, not hidden):** tables inside blockquotes, callouts, lists are not editable; East Asian wide characters count as one column; Enter on an empty last row does not leave the table; the `setContent` fallback has no undo history.
