import { describe, expect, test } from "bun:test";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";
import {
  byColumn,
  candidateKeys,
  cellCommit,
  cellInputType,
  canMove,
  clampWidth,
  coerceInput,
  columnAt,
  coverSource,
  dragStarted,
  editText,
  filtersFrom,
  formatScalar,
  flatFilters,
  isEditable,
  linkParts,
  moveChange,
  moveColumn,
  moveRowInResult,
  presetValue,
  patchRowRevision,
  patchRowValues,
  propNameOf,
  summarise,
  toggleColumn,
} from "../src/bases/model";

describe("columns and editing", () => {
  test("propNameOf and isEditable", () => {
    expect(propNameOf("status")).toBe("status");
    expect(propNameOf("note.status")).toBe("status");
    expect(propNameOf("file.name")).toBeNull();
    expect(propNameOf("formula.x")).toBeNull();
    expect(isEditable("text", "status", "a")).toBe(true);
    expect(isEditable("file", "file.size", 3)).toBe(false);
    expect(isEditable("text", "meta", { a: 1 })).toBe(false);
    expect(isEditable("formula", "formula.x", 1)).toBe(false);
  });

  test("isEditable refuses values the editor cannot show faithfully", () => {
    expect(isEditable("number", "n", "n/a")).toBe(false);
    expect(isEditable("number", "n", Number.POSITIVE_INFINITY)).toBe(false);
    expect(isEditable("number", "n", 3)).toBe(true);
    expect(isEditable("number", "n", null)).toBe(true);
    expect(isEditable("text", "t", "a\nb")).toBe(false);
    expect(isEditable("multitext", "l", [{ a: 1 }])).toBe(false);
    expect(isEditable("multitext", "l", "a, b")).toBe(false);
    expect(isEditable("multitext", "l", ["a", "b"])).toBe(true);
    expect(isEditable("checkbox", "c", "yes")).toBe(false);
    expect(isEditable("text", "t", ["a"])).toBe(false);
  });

  test("list cells that would not survive a comma-joined edit are read-only", () => {
    expect(isEditable("aliases", "a", ["Smith, John", "JS"])).toBe(false);
    expect(isEditable("multitext", "l", [1, 2])).toBe(false);
    expect(isEditable("multitext", "l", [null, true, "a"])).toBe(false);
    expect(isEditable("tags", "t", ["my tag"])).toBe(false);
    expect(isEditable("tags", "t", ["#x"])).toBe(false);
    expect(isEditable("tags", "t", ["a", "b-c"])).toBe(true);
    expect(isEditable("tags", "t", [])).toBe(true);
    expect(isEditable("tags", "t", null)).toBe(true);
  });

  test("a lone string under a list type is editable only when nothing would change", () => {
    expect(isEditable("tags", "t", "work")).toBe(true);
    expect(isEditable("tags", "t", "my tag")).toBe(false);
    expect(isEditable("aliases", "a", "a, b")).toBe(false);
    expect(isEditable("aliases", "a", "")).toBe(false);
    expect(isEditable("multitext", "m", "x\ny")).toBe(false);
    expect(isEditable("multitext", "m", ["a", "x\ny"])).toBe(false);
    expect(isEditable("multitext", "m", ["a\r"])).toBe(false);
  });

  test("cells the server altered are read-only", () => {
    expect(isEditable("text", "status", "a", ["status"])).toBe(false);
    expect(isEditable("text", "status", "a", ["other"])).toBe(true);
  });

  test("coerceInput is strict about numbers and checkboxes", () => {
    for (const bad of ["0x10", "0b11", "1e3", "9007199254740993", "--1", "1,5"]) expect(coerceInput("number", bad).kind).toBe("error");
    expect(coerceInput("number", "-3.50")).toEqual({ kind: "set", value: -3.5 });
    expect(coerceInput("checkbox", "no")).toEqual({ kind: "set", value: false });
    expect(coerceInput("checkbox", "maybe").kind).toBe("error");
  });

  test("coerceInput by type", () => {
    expect(coerceInput("number", " 12.5 ")).toEqual({ kind: "set", value: 12.5 });
    expect(coerceInput("number", "abc")).toEqual({ kind: "error", message: "Not a number" });
    expect(coerceInput("number", "")).toEqual({ kind: "unset" });
    expect(coerceInput("text", "  hi ")).toEqual({ kind: "set", value: "hi" });
    expect(coerceInput("date", "2026-12-01")).toEqual({ kind: "set", value: "2026-12-01" });
    expect(coerceInput("multitext", "a, b,, c")).toEqual({ kind: "set", value: ["a", "b", "c"] });
    expect(coerceInput("tags", "#a, b")).toEqual({ kind: "set", value: ["a", "b"] });
    expect(coerceInput("multitext", " , ")).toEqual({ kind: "unset" });
    expect(coerceInput("tags", "##a, b c,  #")).toEqual({ kind: "set", value: ["a", "b-c"] });
    expect(coerceInput("checkbox", "true")).toEqual({ kind: "set", value: true });
  });

  test("editText", () => {
    expect(editText(null)).toBe("");
    expect(editText(["a", "b"])).toBe("a, b");
    expect(editText(3)).toBe("3");
    expect(editText(false)).toBe("false");
  });

  test("linkParts", () => {
    expect(linkParts("[[people/Ann]]")).toEqual({ target: "people/Ann", label: "Ann" });
    expect(linkParts("[[Ann|The Ann]]")).toEqual({ target: "Ann", label: "The Ann" });
    expect(linkParts("[[Ann#Heading]]")).toEqual({ target: "Ann", label: "Ann" });
    expect(linkParts("plain")).toBeNull();
    expect(linkParts("[[]]")).toBeNull();
  });

  test("width and column order helpers", () => {
    expect(clampWidth(10)).toBe(60);
    expect(clampWidth(5000)).toBe(800);
    expect(clampWidth(150.6)).toBe(151);
    expect(toggleColumn([], "status")).toEqual(["file.name", "status"]);
    expect(toggleColumn(["file.name", "status"], "status")).toEqual(["file.name"]);
    expect(moveColumn(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveColumn(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });

  test("simple filter editor round trip", () => {
    expect(flatFilters(undefined)).toEqual([]);
    expect(flatFilters("a == 1")).toEqual(["a == 1"]);
    expect(flatFilters({ and: ["a", "b"] })).toEqual(["a", "b"]);
    expect(flatFilters({ or: ["a"] })).toBeNull();
    expect(flatFilters({ and: ["a", { not: ["b"] }] })).toBeNull();
    expect(filtersFrom([" a ", ""])).toEqual({ and: ["a"] });
    expect(filtersFrom([])).toBeNull();
  });
});

describe("summaries", () => {
  const v = [3, 1, 2, null, "x"];
  test("numeric", () => {
    expect(summarise("Sum", v)).toBe("6");
    expect(summarise("Average", v)).toBe("2");
    expect(summarise("Min", v)).toBe("1");
    expect(summarise("Max", v)).toBe("3");
    expect(summarise("Range", v)).toBe("2");
    expect(summarise("Median", [1, 2, 3, 4])).toBe("2.5");
    expect(summarise("Average", [1, 2])).toBe("1.5");
    expect(summarise("Sum", ["a"])).toBeNull();
  });
  test("counts and dates", () => {
    expect(summarise("Empty", [null, "", [], "a"])).toBe("3");
    expect(summarise("Filled", [null, "", [], "a"])).toBe("1");
    expect(summarise("Checked", [true, false, true, null])).toBe("2");
    expect(summarise("Unchecked", [true, false, true, null])).toBe("1");
    expect(summarise("Unique", ["a", "a", "b", null])).toBe("2");
    expect(summarise("Earliest", ["2026-12-01", "2026-01-05"])).toBe("2026-01-05");
    expect(summarise("Latest", ["2026-12-01", "2026-01-05"])).toBe("2026-12-01");
    expect(summarise("Nope", [1])).toBeNull();
  });
  test("Earliest and Latest compare instants and skip non-dates", () => {
    const mixed = ["2026-01-05T10:00:00+05:00", "2026-01-05T08:00:00Z", "later", "12", "2026-01-05"];
    expect(summarise("Earliest", mixed)).toBe("2026-01-05");
    expect(summarise("Latest", mixed)).toBe("2026-01-05T08:00:00Z");
    expect(summarise("Earliest", mixed.slice(0, 2))).toBe("2026-01-05T10:00:00+05:00");
    expect(summarise("Earliest", ["later", "12"])).toBeNull();
    expect(summarise("Latest", ["2026-01-05T10:00:00+0100", "2026-01-05"])).toBe("2026-01-05T10:00:00+0100");
  });
});

describe("kanban drag", () => {
  test("drag threshold and drop target", () => {
    expect(dragStarted(3, 3)).toBe(false);
    expect(dragStarted(6, 0)).toBe(true);
    const cols = [
      { key: "Todo", left: 0, right: 100, top: 0, bottom: 400 },
      { key: null, left: 110, right: 210, top: 0, bottom: 400 },
    ];
    expect(columnAt(cols, 50, 10)).toEqual({ key: "Todo" });
    expect(columnAt(cols, 150, 10)).toEqual({ key: null });
    expect(columnAt(cols, 105, 10)).toBeUndefined();
  });

  test("moveChange keeps text that does not spell back as the typed value", () => {
    expect(moveChange("number", "007")).toEqual({ set: "007" });
    expect(moveChange("number", "1e3")).toEqual({ set: "1e3" });
    expect(moveChange("number", " 3 ")).toEqual({ set: " 3 " });
    expect(moveChange("checkbox", "yes")).toEqual({ set: "yes" });
    expect(moveChange("checkbox", "false")).toEqual({ set: false });
  });

  test("presetValue gives a list property a one-item list", () => {
    expect(presetValue("multitext", "a")).toEqual({ set: ["a"] });
    expect(presetValue("tags", null)).toEqual({ unset: true });
    expect(presetValue("number", "007")).toEqual({ set: "007" });
    expect(presetValue("number", "3")).toEqual({ set: 3 });
    expect(presetValue(undefined, "x")).toEqual({ set: "x" });
    expect(presetValue("multitext", "a, b")).toBeNull();
    expect(presetValue("text", "a, b")).toEqual({ set: "a, b" });
  });

  test("canMove refuses lists, nested values and partial cells", () => {
    expect(canMove("text", "a")).toBe(true);
    expect(canMove(undefined, null)).toBe(true);
    expect(canMove("multitext", "a")).toBe(false);
    expect(canMove("text", ["a"])).toBe(false);
    expect(canMove("text", { a: 1 })).toBe(false);
    expect(canMove("text", "a", true)).toBe(false);
  });

  test("moveChange writes the right type", () => {
    expect(moveChange("text", "Done")).toEqual({ set: "Done" });
    expect(moveChange(undefined, "Done")).toEqual({ set: "Done" });
    expect(moveChange("number", "3")).toEqual({ set: 3 });
    expect(moveChange("number", "x")).toEqual({ set: "x" });
    expect(moveChange("checkbox", "true")).toEqual({ set: true });
    expect(moveChange("multitext", "a")).toBeNull();
    expect(moveChange("tags", null)).toBeNull();
    expect(moveChange("text", null)).toEqual({ unset: true });
  });
});

const board = (): BaseQueryResponse => ({
  views: [{ name: "B", type: "kanban" }],
  view: "B",
  columns: [{ key: "file.name", label: "Name", type: "file" }],
  groups: [
    { key: "Todo", label: "Todo", count: 2, rows: [{ path: "a.md", title: "a", revision: "1", values: { "file.name": "a.md" } }, { path: "b.md", title: "b", revision: "2", values: {} }] },
    { key: "Done", label: "Done", count: 0, rows: [] },
  ],
  total: 2,
  warnings: [],
});

describe("optimistic result updates", () => {
  test("moveRowInResult moves a card and adjusts counts", () => {
    const r = moveRowInResult(board(), "a.md", "Done");
    expect(r.groups.map((g) => [g.key, g.count, g.rows.map((x) => x.path)])).toEqual([["Todo", 1, ["b.md"]], ["Done", 1, ["a.md"]]]);
  });
  test("a No value column is created on demand; an unknown column leaves the result alone", () => {
    expect(moveRowInResult(board(), "a.md", null).groups.at(-1)).toMatchObject({ key: null, label: "No value", count: 1 });
    const same = board();
    expect(moveRowInResult(same, "a.md", "Blocked")).toBe(same);
    expect(moveRowInResult(same, "zzz.md", "Done")).toBe(same);
  });
  test("patchRowValues touches one row", () => {
    const r = patchRowValues(board(), "b.md", { status: "Doing" });
    expect(r.groups[0]!.rows[1]!.values).toEqual({ status: "Doing" });
    expect(r.groups[0]!.rows[0]!.values).toEqual({ "file.name": "a.md" });
  });
  test("patchRowRevision sets one row's revision", () => {
    const r = patchRowRevision(board(), "b.md", "9");
    expect(r.groups[0]!.rows[1]!.revision).toBe("9");
    expect(r.groups[0]!.rows[0]!.revision).toBe("1");
  });
  test("candidateKeys", () => {
    const k = candidateKeys(["status", "file.name"], ["late"]);
    expect(k).toContain("file.mtime");
    expect(k).toContain("status");
    expect(k).toContain("formula.late");
    expect(new Set(k).size).toBe(k.length);
  });
});

describe("cover images", () => {
  test("external URL, media file next to the note, and refusals", () => {
    expect(coverSource("a/b.md", "https://x.test/p.png")).toEqual({ external: "https://x.test/p.png" });
    expect(coverSource("a/b.md", "[[pic.png]]")).toEqual({ media: "a/.media/pic.png" });
    expect(coverSource("b.md", "![[sub/pic.JPG|200]]")).toEqual({ media: ".media/pic.JPG" });
    expect(coverSource("a/b.md", "pic.webp")).toEqual({ media: "a/.media/pic.webp" });
    expect(coverSource("a/b.md", ["[[pic.png]]", "x"])).toEqual({ media: "a/.media/pic.png" });
    expect(coverSource("a/b.md", "notes.txt")).toBeNull();
    expect(coverSource("a/b.md", 3)).toBeNull();
    expect(coverSource("a/b.md", "")).toBeNull();
  });
});

describe("formatScalar", () => {
  const col = (key: string, type: "file" | "text" | "datetime") => ({ key, label: key, type });
  test("plain values", () => {
    expect(formatScalar(col("n", "text"), 3)).toBe("3");
    expect(formatScalar(col("n", "text"), null)).toBe("");
    expect(formatScalar(col("n", "text"), "hi")).toBe("hi");
    expect(formatScalar(col("n", "text"), { a: 1 })).toBe('{"a":1}');
  });
  test("only real datetimes are reformatted", () => {
    expect(formatScalar(col("when", "datetime"), "12")).toBe("12");
    expect(formatScalar(col("when", "datetime"), "2026-11-26")).toBe("2026-11-26");
  });
  test("timestamps are shown in local time; text that is not a date stays as written", () => {
    const iso = "2026-11-26T10:00:00.000Z";
    expect(formatScalar(col("file.mtime", "file"), iso)).not.toBe(iso);
    expect(formatScalar(col("when", "datetime"), iso)).not.toBe(iso);
    expect(formatScalar(col("file.mtime", "file"), "later")).toBe("later");
  });
});

describe("cellCommit", () => {
  const open = (text: string) => ({ text });
  test("unchanged raw skips", () => {
    expect(cellCommit(open("a"), { value: "a" }, "a", "text")).toEqual({ kind: "skip" });
  });
  test("a stored value that changed while open conflicts", () => {
    expect(cellCommit(open("a"), { value: "b" }, "typed", "text")).toEqual({ kind: "conflict" });
  });
  test("an untouched cell never overwrites a newer value", () => {
    expect(cellCommit(open("a"), { value: "b" }, "a", "text")).toEqual({ kind: "skip" });
  });
  test("a real edit writes", () => {
    expect(cellCommit(open("a"), { value: "a" }, "b", "text")).toEqual({ kind: "write", change: { set: "b" } });
  });
  test("an equal coerced value skips", () => {
    expect(cellCommit(open("1.5"), { value: 1.5 }, "1.50", "number")).toEqual({ kind: "skip" });
    expect(cellCommit(open("x"), { value: "x" }, "x ", "text")).toEqual({ kind: "skip" });
  });
  test("clearing writes unset, or skips when already empty", () => {
    expect(cellCommit(open("a"), { value: "a" }, "", "text")).toEqual({ kind: "write", change: { unset: true } });
    expect(cellCommit(open(""), { value: null }, " ", "text")).toEqual({ kind: "skip" });
  });
  test("a rejected value is an error", () => {
    expect(cellCommit(open("1"), { value: 1 }, "1e3", "number").kind).toBe("error");
  });
});

describe("cellInputType and byColumn", () => {
  test("native datetime input only for a local datetime or empty", () => {
    expect(cellInputType("datetime", "2026-01-01T10:00")).toBe("datetime-local");
    expect(cellInputType("datetime", null)).toBe("datetime-local");
    expect(cellInputType("datetime", "2026-01-01T10:00:00Z")).toBe("text");
    expect(cellInputType("date", "2026-01-01")).toBe("date");
  });
  test("byColumn matches note.x and x", () => {
    expect(byColumn({ "note.x": 1 }, "x")).toBe(1);
    expect(byColumn({ x: 2 }, "note.x")).toBe(2);
    expect(byColumn({ "file.name": 3 }, "x")).toBeUndefined();
  });
});
