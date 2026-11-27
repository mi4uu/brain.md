import { describe, expect, test } from "bun:test";
import {
  BaseYamlError,
  addView,
  deleteView,
  findBaseFences,
  renameView,
  replaceFenceBody,
  setColumnLabel,
  setColumnSize,
  setPath,
  setViewFilters,
  setViewGroupBy,
  setViewOrder,
  setViewSort,
  setViewSummary,
  setViewType,
} from "@brainmd/shared/base-yaml";

const OBSIDIAN_ORDER = `views:
  - type: table
    name: Table
    order:
      - file.name
      - file.backlinks
      - cssclasses
      - file.size
  - type: cards
    name: View
`;

const OBSIDIAN_SORT = `views:
  - type: table
    name: Table
    filters:
      and:
        - file.size < 200
    groupBy:
      property: file.size
      direction: ASC
    order:
      - file.name
      - file.folder
      - file.embeds
      - file.fullname
      - file.tags
      - file.ext
      - file.basename
    sort:
      - property: file.mtime
        direction: ASC
`;

describe("view edits touch only the changed key", () => {
  test("add a sort to the first view, then remove it: byte-identical", () => {
    const withSort = setViewSort(OBSIDIAN_ORDER, 0, [{ property: "file.name", direction: "DESC" }]);
    expect(withSort).toBe(`views:
  - type: table
    name: Table
    order:
      - file.name
      - file.backlinks
      - cssclasses
      - file.size
    sort:
      - property: file.name
        direction: DESC
  - type: cards
    name: View
`);
    expect(setViewSort(withSort, 0, [])).toBe(OBSIDIAN_ORDER);
  });

  test("replace a sort in place, keeping every other key", () => {
    const out = setViewSort(OBSIDIAN_SORT, 0, [{ property: "file.name", direction: "DESC" }]);
    expect(out).toBe(OBSIDIAN_SORT.replace("property: file.mtime\n        direction: ASC", "property: file.name\n        direction: DESC"));
  });

  test("delete groupBy and filters", () => {
    const noGroup = setViewGroupBy(OBSIDIAN_SORT, 0, null);
    expect(noGroup).not.toContain("groupBy");
    expect(noGroup).toContain("- file.size < 200");
    const noFilter = setViewFilters(OBSIDIAN_SORT, 0, null);
    expect(noFilter).not.toContain("filters");
    expect(noFilter).toContain("groupBy:");
  });

  test("replace a column list", () => {
    expect(setViewOrder(OBSIDIAN_ORDER, 0, ["file.name", "status"])).toBe(`views:
  - type: table
    name: Table
    order:
      - file.name
      - status
  - type: cards
    name: View
`);
  });

  test("scalar replacement keeps a trailing comment and unknown keys", () => {
    const src = "# top\nviews:\n  - type: table   # kind\n    name: Table\n    limit: 10 # keep\n    unknown: {a: 1}\nfoo: bar\n";
    expect(setPath(src, ["views", 0, "limit"], 20)).toBe(src.replace("limit: 10", "limit: 20"));
    expect(setViewType(src, 0, "cards")).toBe(src.replace("type: table", "type: cards"));
  });

  test("rename a view and quote a name that YAML would misread", () => {
    expect(renameView(OBSIDIAN_ORDER, 1, "My: board")).toContain('name: "My: board"');
  });

  test("CRLF sources stay CRLF", () => {
    const crlf = OBSIDIAN_ORDER.replace(/\n/g, "\r\n");
    const out = setViewSort(crlf, 0, [{ property: "a", direction: "ASC" }]);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain("sort:\r\n      - property: a\r\n        direction: ASC\r\n");
  });

  test("a source without a trailing newline", () => {
    const src = "views:\n  - type: table\n    name: T";
    expect(setViewSort(src, 0, [{ property: "a", direction: "ASC" }])).toBe(
      "views:\n  - type: table\n    name: T\n    sort:\n      - property: a\n        direction: ASC",
    );
  });
});

describe("expressions that YAML would misread are quoted", () => {
  test("leading !, colon-space and hash", () => {
    const out = setViewFilters(OBSIDIAN_ORDER, 1, {
      and: ['!file.hasTag("a")', "a: b", "x # y", 'status == "Done"', "file.size < 200"],
    });
    expect(out).toContain(`- '!file.hasTag("a")'`);
    expect(out).toContain('- "a: b"');
    expect(out).toContain('- "x # y"');
    expect(out).toContain('- status == "Done"');
    expect(out).toContain("- file.size < 200");
  });

  test("nested and / or / not", () => {
    const out = setViewFilters(OBSIDIAN_ORDER, 0, { and: ["a", { not: ["b"] }] });
    expect(out).toContain("filters:\n      and:\n        - a\n        - not:\n            - b\n");
  });
});

describe("column size and labels", () => {
  test("creates, extends and replaces the columnSize map", () => {
    const a = setColumnSize(OBSIDIAN_SORT, 0, "file.name", 200.4);
    expect(a.endsWith("    columnSize:\n      file.name: 200\n")).toBe(true);
    const b = setColumnSize(a, 0, "status", 120);
    expect(b.endsWith("      file.name: 200\n      note.status: 120\n")).toBe(true);
    expect(setColumnSize(b, 0, "note.status", 130)).toBe(b.replace("note.status: 120", "note.status: 130"));
    expect(setColumnSize(b, 0, "file.name", 300)).toBe(b.replace("file.name: 200", "file.name: 300"));
  });

  test("creates properties.displayName at the top level", () => {
    expect(setColumnLabel(OBSIDIAN_ORDER, "status", "State")).toBe(`${OBSIDIAN_ORDER}properties:\n  status:\n    displayName: State\n`);
  });
});

describe("summaries", () => {
  test("set, change, clear", () => {
    const a = setViewSummary(OBSIDIAN_SORT, 0, "n", "Sum");
    expect(a.endsWith("    summaries:\n      n: Sum\n")).toBe(true);
    const b = setViewSummary(a, 0, "n", "Average");
    expect(b).toBe(a.replace("Sum", "Average"));
    expect(setViewSummary(a, 0, "n", null)).toBe(`${OBSIDIAN_SORT}    summaries:\n`);
  });
});

describe("views list", () => {
  test("add and delete", () => {
    const added = addView(OBSIDIAN_ORDER, { type: "list", name: "List" });
    expect(added).toBe(`${OBSIDIAN_ORDER}  - type: list\n    name: List\n`);
    expect(deleteView(added, 2)).toBe(OBSIDIAN_ORDER);
    expect(deleteView(OBSIDIAN_ORDER, 0)).toBe("views:\n  - type: cards\n    name: View\n");
  });

  test("add to an empty source and next to other top-level keys", () => {
    expect(addView("", { type: "table", name: "Table" })).toBe("views:\n  - type: table\n    name: Table\n");
    expect(addView("filters: x == 1\n", { type: "table", name: "Table" })).toBe(
      "filters: x == 1\nviews:\n  - type: table\n    name: Table\n",
    );
  });
});

describe("addView on an empty flow list", () => {
  test("views: [] becomes a block list", () => {
    expect(addView("views: []\n", { type: "table", name: "Table" })).toBe("views:\n  - type: table\n    name: Table\n");
  });

  test("a non-empty flow list is still refused", () => {
    try {
      addView("views: [ {type: table} ]\n", { type: "list", name: "L" });
      throw new Error("should refuse");
    } catch (e) {
      expect((e as BaseYamlError).code).toBe("UNSUPPORTED_STYLE");
    }
  });
});

describe("refusals", () => {
  test("invalid YAML", () => {
    expect(() => setViewSort("views: [", 0, [])).toThrow(BaseYamlError);
    try {
      setViewSort("views: [", 0, []);
    } catch (e) {
      expect((e as BaseYamlError).code).toBe("INVALID_YAML");
    }
  });

  test("inline (flow) style cannot be spliced", () => {
    try {
      setPath("views: [ {type: table} ]", ["views", 0, "sort"], [1]);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as BaseYamlError).code).toBe("UNSUPPORTED_STYLE");
    }
  });
});

describe("findBaseFences and replaceFenceBody", () => {
  const md =
    "---\ntitle: x\n---\n\nintro\n\n```base\nviews:\n  - type: table\n    name: T\n```\n\n```js\n```base\n```\n\n~~~base\nviews: []\n~~~\n\n```base\n```\n";

  test("finds base fences, skips ones inside other fences, reports 1-based lines", () => {
    const f = findBaseFences(md);
    expect(f.map((x) => [x.startLine, x.endLine, x.closed])).toEqual([
      [7, 11, true],
      [17, 19, true],
      [21, 22, true],
    ]);
    expect(f[0]!.source).toBe("views:\n  - type: table\n    name: T");
    expect(f[1]!.source).toBe("views: []");
  });

  test("replaceFenceBody swaps only the body", () => {
    const f = findBaseFences(md)[0]!;
    const e = replaceFenceBody(md, f, "views:\n  - type: cards\n    name: C\n");
    expect(md.slice(0, e.from) + e.insert + md.slice(e.to)).toBe(
      md.replace("  - type: table\n    name: T", "  - type: cards\n    name: C"),
    );
  });

  test("an empty fence gets a body and a line break", () => {
    const f = findBaseFences(md)[2]!;
    const e = replaceFenceBody(md, f, "views: []");
    expect(md.slice(0, e.from) + e.insert + md.slice(e.to)).toBe(`${md.slice(0, md.lastIndexOf("```base\n```\n"))}\`\`\`base\nviews: []\n\`\`\`\n`);
  });

  test("an unclosed fence runs to the end of the note", () => {
    const f = findBaseFences("a\n```base\nviews: []");
    expect(f).toHaveLength(1);
    expect(f[0]!.closed).toBe(false);
    expect(f[0]!.source).toBe("views: []");
  });

  test("CRLF notes", () => {
    const f = findBaseFences("```base\r\nviews: []\r\n```\r\n");
    expect(f[0]!.source).toBe("views: []");
    const e = replaceFenceBody("```base\r\nviews: []\r\n```\r\n", f[0]!, "a: 1\nb: 2");
    expect(e.insert).toBe("a: 1\r\nb: 2");
  });
});

describe("edits never lose data", () => {
  const code = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (e) {
      return (e as BaseYamlError).code;
    }
    return undefined;
  };
  const sort = [{ property: "a", direction: "ASC" as const }];

  test("deleteView refuses inline lists and inline items", () => {
    expect(code(() => deleteView("views: [{a: 1}, {b: 2}]\n", 0))).toBe("UNSUPPORTED_STYLE");
    expect(code(() => deleteView("views:\n  - {a: 1}\n  - {b: 2}\n", 5))).toBe("NOT_FOUND");
  });

  test("a list index is never written into a new node", () => {
    expect(code(() => setViewSort("views:\n", 0, sort))).toBe("NOT_FOUND");
    expect(code(() => setViewSort("", 0, sort))).toBe("NOT_FOUND");
  });

  test("a scalar in the way is never overwritten", () => {
    expect(code(() => setViewSort("views: x\n", 0, sort))).toBe("UNSUPPORTED_STYLE");
    expect(code(() => setColumnLabel("properties: x\n", "s", "S"))).toBe("UNSUPPORTED_STYLE");
    expect(code(() => addView("views: x\n", { type: "table", name: "T" }))).toBe("UNSUPPORTED_STYLE");
  });

  test("addView on a null views key creates the list", () => {
    expect(addView("views:\n", { type: "table", name: "T" })).toBe("views:\n  - type: table\n    name: T\n");
  });

  test("verification refuses a splice that changes the parsed result", () => {
    expect(code(() => setPath("a: !!str 1\n", ["a"], 2))).toBe("UNSUPPORTED_STYLE");
  });

  test("__proto__ is an ordinary key", () => {
    const out = setPath("a: 1\n", ["__proto__", "x"], 1);
    expect(out).toBe("a: 1\n__proto__:\n  x: 1\n");
    expect(Object.hasOwn(Object.prototype, "x")).toBe(false);
  });
});
