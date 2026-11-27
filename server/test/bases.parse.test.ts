import { describe, expect, test } from "bun:test";
import { parseBase } from "../src/bases/parse";

const ORDER = `views:
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

const SORT = `views:
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

describe("parseBase on files Obsidian wrote", () => {
  test("column order and a second view", () => {
    const r = parseBase(ORDER);
    expect(r.fatal).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.config.views.map((v) => [v.type, v.name])).toEqual([["table", "Table"], ["cards", "View"]]);
    expect(r.config.views[0]!.order).toEqual(["file.name", "file.backlinks", "cssclasses", "file.size"]);
  });

  test("filter, group and sort", () => {
    const v = parseBase(SORT).config.views[0]!;
    expect(v.filters).toEqual({ and: ["file.size < 200"] });
    expect(v.groupBy).toEqual({ property: "file.size", direction: "ASC" });
    expect(v.sort).toEqual([{ property: "file.mtime", direction: "ASC" }]);
    expect(v.order).toContain("file.fullname");
  });
});

describe("parseBase tolerance", () => {
  test("top-level keys, nested filters, formulas, displayName, summaries", () => {
    const r = parseBase(`filters:
  or:
    - file.hasTag("a")
    - not:
        - status == "Done"
formulas:
  late: due < today()
properties:
  status:
    displayName: State
summaries:
  n: Sum
views:
  - type: kanban
    name: Board
    groupBy: { property: status, direction: desc }
    groupOrder: [Todo, Doing, Done]
    limit: 25
    columnSize: { file.name: 240, bad: -1 }
    image: cover
    summaries: { n: Average }
    futureKey: 1
`);
    expect(r.warnings).toEqual([]);
    expect(r.config.filters).toEqual({ or: ['file.hasTag("a")', { not: ['status == "Done"'] }] });
    expect(r.config.formulas.late).toBe("due < today()");
    expect(r.config.properties.status).toEqual({ displayName: "State" });
    expect(r.config.summaries.n).toBe("Sum");
    const v = r.config.views[0]!;
    expect(v.groupBy).toEqual({ property: "status", direction: "DESC" });
    expect(v.groupOrder).toEqual(["Todo", "Doing", "Done"]);
    expect(v.limit).toBe(25);
    expect(v.columnSize).toEqual({ "file.name": 240 });
    expect(v.image).toBe("cover");
    expect(v.summaries.n).toBe("Average");
  });

  test("empty source is a valid base with no views", () => {
    expect(parseBase("")).toMatchObject({ fatal: false, warnings: [], config: { views: [] } });
  });

  test("bad YAML is fatal with a message; wrong shapes only warn", () => {
    const bad = parseBase("views: [");
    expect(bad.fatal).toBe(true);
    expect(bad.warnings[0]).toStartWith("YAML:");
    expect(parseBase("- a\n- b").fatal).toBe(true);
    const odd = parseBase("filters: 5\nviews:\n  - type: 7\n    order: nope\n    sort: [1, {property: x}]\n");
    expect(odd.fatal).toBe(false);
    expect(odd.warnings.length).toBeGreaterThan(0);
    expect(odd.config.views[0]).toMatchObject({ type: "table", order: [], sort: [{ property: "x", direction: "ASC" }] });
  });

  test("__proto__ keys do not pollute", () => {
    const r = parseBase('formulas:\n  __proto__: "1"\nviews: []\n');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(r.config.formulas)).toBeNull();
  });

  test("oversized source is refused", () => {
    expect(parseBase("a: 1\n".repeat(30000)).fatal).toBe(true);
  });
});
