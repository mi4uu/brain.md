import { describe, expect, test } from "bun:test";
import { buildModel, cleanItem, editRename, editSet, editUnset, initialValue, listFor, minimalChange, nativeDate, nativeDateTime, parseNumber, toList } from "../src/properties/model";

const note = "---\ntitle: Hello\ntags: [a, b]\nstatus: todo\ndue: 2026-12-01\nnested:\n  k: 1\n---\n\n# Body\n";

describe("buildModel", () => {
  test("rows with types: registry wins, tags fixed, else inferred", () => {
    const m = buildModel(note, [{ name: "status", type: "text", count: 3, values: ["todo"] }, { name: "due", type: "datetime", count: 1, values: [] }]);
    expect(m.kind).toBe("rows");
    if (m.kind !== "rows") return;
    expect(m.offset).toBe(4);
    expect(m.rows.map((r) => [r.name, r.type, r.nested])).toEqual([
      ["title", "text", false], ["tags", "tags", false], ["status", "text", false], ["due", "datetime", false], ["nested", "text", true],
    ]);
  });
  test("no frontmatter gives no rows", () => {
    expect(buildModel("# x\n", [])).toEqual({ kind: "rows", rows: [], offset: 0 });
  });
  test("invalid yaml gives an error with an offset inside the block", () => {
    const m = buildModel("---\na: [1\n---\nx", []);
    expect(m.kind).toBe("error");
    if (m.kind === "error") expect(m.offset).toBe(4);
  });
});

describe("edits", () => {
  test("set, unset, rename touch only their key", () => {
    expect(editSet("status", "done")(note)).toContain("status: done\ndue: 2026-12-01");
    expect(editUnset("tags")(note)).not.toContain("tags");
    expect(editRename("status", "state")(note)).toContain("state: todo");
  });
  test("initial values", () => {
    expect(initialValue("tags")).toEqual([]);
    expect(initialValue("checkbox")).toBe(false);
    expect(initialValue("text")).toBeNull();
  });
});

describe("value helpers", () => {
  test("lists", () => {
    expect(toList(null)).toEqual([]);
    expect(toList("x")).toEqual(["x"]);
    expect(toList(["a", 1, null, { k: 1 }])).toEqual(["a", "1"]);
    expect(cleanItem("tags", " #my tag ")).toBe("my-tag");
    expect(listFor("tags", ["#a", "a", " ", "b"])).toEqual(["a", "b"]);
  });
  test("numbers and native dates", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber(" 4.5 ")).toBe(4.5);
    expect(nativeDate("2026-01-02")).toBe("2026-01-02");
    expect(nativeDate("next week")).toBeNull();
    expect(nativeDate(null)).toBe("");
    expect(nativeDateTime("2026-01-02T10:30:00Z")).toBe("2026-01-02T10:30");
    expect(nativeDateTime("2026-01-02")).toBeNull();
  });
});

describe("minimalChange", () => {
  test("replaces only the differing middle", () => {
    expect(minimalChange("abcXdef", "abcYYdef")).toEqual({ from: 3, to: 4, insert: "YY" });
    expect(minimalChange("same", "same")).toBeNull();
    expect(minimalChange("ab", "abc")).toEqual({ from: 2, to: 2, insert: "c" });
    const before = "---\na: 1\n---\nbody";
    const after = "---\na: 2\n---\nbody";
    const c = minimalChange(before, after)!;
    expect(before.slice(0, c.from) + c.insert + before.slice(c.to)).toBe(after);
  });
});

describe("offset follows the line ending", () => {
  test("CRLF rows", () => {
    const c = "---\r\ntitle: x\r\n---\r\nbody";
    const m = buildModel(c, []);
    expect(m.kind).toBe("rows");
    expect(c.slice(m.offset)).toStartWith("title");
  });
  test("BOM and CRLF rows", () => {
    const c = "﻿---\r\ntitle: x\r\n---\r\nbody";
    const m = buildModel(c, []);
    expect(m.kind).toBe("rows");
    expect(c.slice(m.offset)).toStartWith("title");
  });
  test("CRLF invalid yaml", () => {
    const c = "---\r\na: [1\r\n---\r\nx";
    const m = buildModel(c, []);
    expect(m.kind).toBe("error");
    expect(c.slice(m.offset)).toStartWith("a:");
  });
});

import { dateCommit, numberCommit } from "../src/properties/model";

describe("numberCommit", () => {
  test("unchanged text writes nothing", () => expect(numberCommit("5", false, "5")).toEqual({ write: false }));
  test("bad input reverts", () => expect(numberCommit("", true, "")).toEqual({ write: false }));
  test("unparseable text reverts", () => expect(numberCommit("1,5", false, "2")).toEqual({ write: false }));
  test("cleared field writes null", () => expect(numberCommit("", false, "5")).toEqual({ write: true, value: null }));
  test("number writes", () => expect(numberCommit("7.5", false, "5")).toEqual({ write: true, value: 7.5 }));
});

describe("dateCommit", () => {
  test("same value writes nothing", () => expect(dateCommit("2026-01-02", false, "2026-01-02")).toEqual({ write: false }));
  test("partial entry reverts", () => expect(dateCommit("", true, "2026-01-02")).toEqual({ write: false }));
  test("cleared writes null", () => expect(dateCommit("", false, "2026-01-02")).toEqual({ write: true, value: null }));
  test("new value writes", () => expect(dateCommit("2026-02-03", false, "2026-01-02")).toEqual({ write: true, value: "2026-02-03" }));
});
