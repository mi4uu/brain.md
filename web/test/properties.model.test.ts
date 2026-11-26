import { describe, expect, test } from "bun:test";
import { addChip, buildModel, chipsOf, cleanItem, editRename, editSet, editUnset, fitsType, initialValue, minimalChange, nativeDate, nativeDateTime, parseNumber, removeChip } from "../src/properties/model";

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
  test("chips: scalar items keep their index, null and maps are not chips", () => {
    expect(chipsOf(null)).toEqual([]);
    expect(chipsOf("")).toEqual([]);
    expect(chipsOf("x")).toEqual([{ label: "x", index: 0 }]);
    expect(chipsOf(["a", 1, null, true])).toEqual([{ label: "a", index: 0 }, { label: "1", index: 1 }, { label: "true", index: 3 }]);
    expect(cleanItem("tags", " #my tag ")).toBe("my-tag");
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

describe("chip edits keep the other items verbatim", () => {
  test("adding keeps numbers, nulls and odd tags as they are", () => {
    expect(addChip("multitext", [2024, 2025], "x")).toEqual([2024, 2025, "x"]);
    expect(addChip("multitext", ["a", null, "b"], "c")).toEqual(["a", null, "b", "c"]);
    expect(addChip("tags", ["my tag", "#area"], " #new one ")).toEqual(["my tag", "#area", "new-one"]);
    expect(addChip("tags", null, "a")).toEqual(["a"]);
    expect(addChip("aliases", "Old name", "New")).toEqual(["Old name", "New"]);
  });
  test("adding nothing new gives null", () => {
    expect(addChip("tags", ["a"], " ")).toBeNull();
    expect(addChip("tags", ["a"], "#a")).toBeNull();
    expect(addChip("multitext", [2024], "2024")).toBeNull();
  });
  test("removing drops only that index", () => {
    expect(removeChip(["Area/Sub", "my tag", "x"], 2)).toEqual(["Area/Sub", "my tag"]);
    expect(removeChip([2024, "2024", 2025], 1)).toEqual([2024, 2025]);
    expect(removeChip(["a", null, "b"], 2)).toEqual(["a", null]);
    expect(removeChip("solo", 0)).toEqual([]);
  });
  test("a round trip through setProperties keeps the file's items", () => {
    const src = "---\nyears: [2024, 2025]\ntags:\n  - my tag\n  - '#area'\n---\n";
    const out = editSet("years", addChip("multitext", [2024, 2025], "x")!)(src);
    expect(out).toBe("---\nyears: [2024, 2025, x]\ntags:\n  - my tag\n  - '#area'\n---\n");
    const out2 = editSet("tags", removeChip(["my tag", "#area"], 0))(src);
    expect(out2).toBe("---\nyears: [2024, 2025]\ntags:\n  - \"#area\"\n---\n");
  });
});

describe("fitsType: a value whose shape does not fit its type is not editable", () => {
  test("scalar types refuse a list", () => {
    expect(fitsType("text", ["a", "b"])).toBe(false);
    expect(fitsType("number", [1])).toBe(false);
    expect(fitsType("date", ["2026-01-01"])).toBe(false);
    expect(fitsType("text", "x")).toBe(true);
    expect(fitsType("text", 5)).toBe(true);
    expect(fitsType("number", null)).toBe(true);
  });
  test("scalar types refuse a multi-line string, a single-line input would join its lines", () => {
    expect(fitsType("text", "line one\nline two\n")).toBe(false);
    expect(fitsType("number", "1\n2")).toBe(false);
    expect(fitsType("date", "2026-01-01\n")).toBe(false);
    expect(fitsType("datetime", "a\nb")).toBe(false);
    expect(fitsType("text", "one line")).toBe(true);
  });
  test("checkbox takes only a boolean or nothing", () => {
    expect(fitsType("checkbox", true)).toBe(true);
    expect(fitsType("checkbox", null)).toBe(true);
    expect(fitsType("checkbox", "yes please")).toBe(false);
    expect(fitsType("checkbox", 1)).toBe(false);
    expect(fitsType("checkbox", [true])).toBe(false);
  });
  test("list types take a list, nothing, or one scalar that would not be split", () => {
    expect(fitsType("tags", ["a"])).toBe(true);
    expect(fitsType("tags", null)).toBe(true);
    expect(fitsType("tags", "work")).toBe(true);
    expect(fitsType("multitext", 2024)).toBe(true);
    expect(fitsType("tags", "work, project")).toBe(false);
    expect(fitsType("tags", "work project")).toBe(false);
    expect(fitsType("aliases", "Old, name")).toBe(false);
    expect(fitsType("aliases", "Old name")).toBe(true);
  });
});
