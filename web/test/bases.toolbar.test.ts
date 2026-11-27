import { describe, expect, test } from "bun:test";
import {
  addSort, buildFilter, isNameTaken, wasApplied, literal, freshName, hideColumn, hiddenOptions, labelOf, nextView, optionKeyFor,
  propertyRef, quoteString, replaceFilter, setSortProperty, shiftColumn, showColumn, sortChoices,
} from "../src/bases/toolbar";

const opts = [{ key: "file.name", label: "Name" }, { key: "note.status", label: "status" }, { key: "note.due", label: "due" }];

describe("toolbar key forms", () => {
  test("bare and note. keys are one entry", () => {
    expect(optionKeyFor(opts, "status")).toBe("note.status");
    expect(labelOf(opts, "due")).toBe("due");
    expect(addSort([{ property: "status", direction: "ASC" }], opts)).toEqual([
      { property: "status", direction: "ASC" },
      { property: "file.name", direction: "ASC" },
    ]);
    expect(addSort([{ property: "file.name", direction: "ASC" }, { property: "status", direction: "ASC" }, { property: "note.due", direction: "ASC" }], opts)).toBeNull();
  });
  test("sort property cannot duplicate another sort", () => {
    const s = [{ property: "status", direction: "ASC" as const }, { property: "file.name", direction: "DESC" as const }];
    expect(setSortProperty(s, 1, "note.status")).toBeNull();
    expect(setSortProperty(s, 1, "due")![1]).toEqual({ property: "due", direction: "DESC" });
    expect(sortChoices(s, opts, 1).map((o) => o.key)).toEqual(["file.name", "note.due"]);
  });
  test("order edits match across key forms", () => {
    expect(hideColumn(["file.name", "status"], "note.status")).toEqual(["file.name"]);
    expect(hideColumn(["status"], "status")).toBeNull();
    expect(showColumn(["file.name", "status"], "note.status")).toEqual(["file.name", "status"]);
    expect(showColumn([], "note.due")).toEqual(["file.name", "note.due"]);
    expect(shiftColumn(["file.name", "status"], "note.status", -1)).toEqual(["status", "file.name"]);
    expect(shiftColumn(["file.name", "status"], "status", 1)).toBeNull();
    expect(hiddenOptions(["file.name", "status"], opts).map((o) => o.key)).toEqual(["note.due"]);
  });
  test("names", () => {
    expect(freshName("Table", ["Table", "Table 2"])).toBe("Table 3");
    expect(nextView([{ name: "a" }, { name: "b" }], 0)).toBe("b");
  });
});

describe("filter building", () => {
  test("quoting escapes quote, backslash and newline", () => {
    expect(quoteString('a"b')).toBe('"a\\"b"');
    expect(quoteString("a\\")).toBe('"a\\\\"');
    expect(quoteString("a\nb")).toBe('"a\\nb"');
  });
  test("injection stays inside the literal", () => {
    expect(buildFilter("status", "is", 'x") || true || ("')).toBe('note.status == "x\\") || true || (\\""');
    expect(buildFilter("status", "contains", 'a")')).toBe('note.status.contains("a\\")")');
  });
  test("property refs", () => {
    expect(propertyRef("status")).toBe("note.status");
    expect(propertyRef("file.name")).toBe("file.name");
    expect(propertyRef("my prop")).toBe('note["my prop"]');
    expect(propertyRef('a"b')).toBe('note["a\\"b"]');
    expect(propertyRef("file.a b")).toBeNull();
    expect(propertyRef("note.")).toBeNull();
  });
  test("operators", () => {
    expect(buildFilter("due", "gt", "5")).toBe("note.due > 5");
    expect(buildFilter("status", "is", "5x")).toBe('note.status == "5x"');
    expect(buildFilter("status", "isNot", "Done")).toBe('note.status != "Done"');
    expect(buildFilter("status", "empty", "")).toBe("note.status.isEmpty()");
    expect(buildFilter("status", "notEmpty", "")).toBe("!note.status.isEmpty()");
    expect(buildFilter("status", "is", "  ")).toBeNull();
    expect(buildFilter("file.a b", "empty", "")).toBeNull();
  });
  test("replaceFilter", () => {
    expect(replaceFilter(["a", "b"], 1, " b ")).toBeNull();
    expect(replaceFilter(["a", "b"], 1, "c")).toEqual(["a", "c"]);
    expect(replaceFilter(["a", "b"], 0, "")).toEqual(["", "b"]);
  });
});

describe("literals and refusal helpers", () => {
  test("untyped values", () => {
    expect(buildFilter("done", "is", "true")).toBe("note.done == true");
    expect(buildFilter("done", "isNot", "false")).toBe("note.done != false");
    expect(buildFilter("code", "is", "01234")).toBe('note.code == "01234"');
    expect(buildFilter("code", "is", "12345678901234567890")).toBe('note.code == "12345678901234567890"');
    expect(buildFilter("n", "is", "0.5")).toBe("note.n == 0.5");
    expect(buildFilter("n", "is", "0")).toBe("note.n == 0");
  });
  test("registry type decides", () => {
    expect(buildFilter("zip", "is", "5", "text")).toBe('note.zip == "5"');
    expect(buildFilter("flag", "is", "true", "text")).toBe('note.flag == "true"');
    expect(buildFilter("n", "is", "01234", "number")).toBe("note.n == 1234");
    expect(buildFilter("n", "is", "abc", "number")).toBeNull();
    expect(buildFilter("n", "is", "12345678901234567890", "number")).toBeNull();
    expect(buildFilter("done", "is", "true", "checkbox")).toBe("note.done == true");
    expect(buildFilter("done", "is", "yes", "checkbox")).toBeNull();
    expect(literal("5", "date")).toBe('"5"');
  });
  test("CRLF collapses to one newline escape", () => {
    expect(quoteString("a\r\nb")).toBe('"a\\nb"');
    expect(quoteString("a\rb")).toBe('"a\\nb"');
  });
  test("name collisions", () => {
    expect(isNameTaken(["A", "B"], "B", 0)).toBe(true);
    expect(isNameTaken(["A", "B"], "B", 1)).toBe(false);
    expect(isNameTaken(["A", "B"], "C", 0)).toBe(false);
  });
  test("refusal", () => {
    expect(wasApplied(false)).toBe(false);
    expect(wasApplied(true)).toBe(true);
    expect(wasApplied(undefined)).toBe(true);
  });
});
