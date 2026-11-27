import { describe, expect, test } from "bun:test";
import { runBaseQuery, type QueryEntry, type QueryIndex } from "../src/bases/query";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";

const NOW = new Date(2026, 10, 26, 12, 0);

function entry(path: string, props: Record<string, PropValue>, over: Partial<QueryEntry> = {}): QueryEntry {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return {
    path,
    title: base,
    size: 100,
    mtime: Date.UTC(2026, 10, 1),
    ctime: Date.UTC(2026, 9, 1),
    tags: [],
    props,
    revision: `rev-${base}`,
    outLinks: [],
    ...over,
  };
}

const ENTRIES: QueryEntry[] = [
  entry("tasks/A.md", { status: "Todo", n: 10, due: "2026-12-05", owner: "[[people/Ann]]" }, { tags: ["work"], size: 50 }),
  entry("tasks/B.md", { status: "Doing", n: 2, due: "2026-11-01" }, { tags: ["work", "urgent"], outLinks: [{ target: "A", embed: false }, { target: "secret/S", embed: false }] }),
  entry("tasks/C.md", { status: "Done", n: 33 }, { size: 300 }),
  entry("tasks/D.md", { n: 5, owner: ["[[people/Ann]]", "[[secret/S]]"] }),
  entry("secret/S.md", { status: "Todo", n: 1 }),
  entry("hidden/H.md", { status: "Todo", n: 99 }),
  entry("people/Ann.md", { role: "dev" }),
  entry("views/V.md", { x: "view-note", status: "Todo", n: 7 }),
];

function index(over: Partial<QueryIndex> = {}): QueryIndex {
  return {
    entries: () => ENTRIES,
    backlinks: (p, allowed) =>
      ENTRIES.filter((e) => e.outLinks.some((l) => (l.target === "A" ? "tasks/A.md" : l.target === "secret/S" ? "secret/S.md" : "") === p))
        .map((e) => ({ from: e.path }))
        .filter((b) => !allowed || allowed(b.from)),
    resolveLink: (_f, t) => ENTRIES.find((e) => e.path.replace(/\.md$/, "") === t || e.path.endsWith(`/${t}.md`))?.path,
    visibility: { isHidden: (p) => p.startsWith("hidden/") },
    ...over,
  };
}

const TYPES = new Map<string, PropertyType>([
  ["status", "text"],
  ["n", "number"],
  ["due", "date"],
  ["owner", "multitext"],
]);

const ALL = () => true;
const NO_SECRET = (p: string) => !p.startsWith("secret/");

function q(source: string, o: { allowed?: (p: string) => boolean; req?: object; idx?: QueryIndex } = {}) {
  return runBaseQuery({ source, ...o.req }, { index: o.idx ?? index(), allowed: o.allowed ?? ALL, types: TYPES, now: NOW });
}

const paths = (r: ReturnType<typeof q>) => r.groups.flatMap((g) => g.rows.map((x) => x.path));

describe("shape", () => {
  test("default view, default column, hidden and own note left out", () => {
    const r = q("", { req: { thisPath: "views/V.md" } });
    expect(r.views).toEqual([{ name: "Table", type: "table" }]);
    expect(r.view).toBe("Table");
    expect(r.columns).toEqual([{ key: "file.name", label: "Name", type: "file" }]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ key: null, label: "" });
    expect(paths(r)).not.toContain("hidden/H.md");
    expect(paths(r)).not.toContain("views/V.md");
    expect(r.total).toBe(6);
    expect(r.groups[0]!.rows[0]).toEqual({ path: expect.any(String), title: expect.any(String), revision: expect.stringMatching(/^rev-/), values: expect.any(Object) });
  });

  test("columns: labels, types, displayName, formulas", () => {
    const r = q(`properties:\n  status:\n    displayName: State\nformulas:\n  big: n > 9\nviews:\n  - type: table\n    name: T\n    order: [file.name, status, n, due, formula.big, note.owner, file.size]\n`);
    expect(r.columns).toEqual([
      { key: "file.name", label: "Name", type: "file" },
      { key: "status", label: "State", type: "text" },
      { key: "n", label: "n", type: "number" },
      { key: "due", label: "due", type: "date" },
      { key: "formula.big", label: "big", type: "formula" },
      { key: "note.owner", label: "owner", type: "multitext" },
      { key: "file.size", label: "Size", type: "file" },
    ]);
  });

  test("bad YAML: empty response with a warning, no throw", () => {
    const r = q("views: [");
    expect(r.groups).toEqual([]);
    expect(r.warnings[0]).toStartWith("YAML:");
  });

  test("unknown view falls back to the first with a warning; names match case-insensitively", () => {
    const src = "views:\n  - type: table\n    name: One\n  - type: list\n    name: Two\n";
    expect(q(src, { req: { view: "two" } }).view).toBe("Two");
    const r = q(src, { req: { view: "Nope" } });
    expect(r.view).toBe("One");
    expect(r.warnings).toEqual(['view "Nope" was not found; showing "One"']);
  });
});

describe("filters", () => {
  test("global and view filters combine with AND; and / or / not", () => {
    const r = q(`filters: file.inFolder("tasks")
views:
  - type: table
    name: T
    filters:
      or:
        - status == "Todo"
        - and:
            - n < 6
            - not:
                - file.hasTag("urgent")
`);
    expect(paths(r).sort()).toEqual(["tasks/A.md", "tasks/D.md"]);
  });

  test("a filter that cannot be parsed is ignored with a warning; the view is not blanked", () => {
    const r = q('views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - "n ? 1"\n        - status == "Done"\n');
    expect(paths(r)).toEqual(["tasks/C.md"]);
    expect(r.warnings[0]).toStartWith("filter ignored");
    expect(q('filters: "n ? 1"\n').total).toBe(7);
  });

  test("an unsupported function inside a filter is null, so the row is out, plus one warning", () => {
    const r = q('filters: sum(n) > 1\n');
    expect(r.total).toBe(0);
    expect(r.warnings).toEqual(['unsupported function "sum"']);
  });

  test("this binds to thisPath", () => {
    const r = q('filters: status == this.status\n', { req: { thisPath: "views/V.md" } });
    expect(paths(r).sort()).toEqual(["secret/S.md", "tasks/A.md"]);
  });

  test("this is ignored, with a warning, when the caller cannot read thisPath", () => {
    const r = q('filters: this.status == "Todo"\n', { allowed: NO_SECRET, req: { thisPath: "secret/S.md" } });
    expect(r.total).toBe(0);
    expect(r.warnings).toContain("the note holding this view is not readable; `this` was left empty");
  });

  test("file.* in filters", () => {
    expect(paths(q("filters: file.size < 100\n"))).toEqual(["tasks/A.md"]);
    expect(paths(q('filters: file.hasLink("A")\n'))).toEqual(["tasks/B.md"]);
    expect(paths(q("filters: file.backlinks.length > 0\n")).sort()).toEqual(["secret/S.md", "tasks/A.md"]);
  });
});

describe("formulas", () => {
  test("evaluate per row, may use other formulas, cycles give null", () => {
    const r = q(`formulas:
  double: n * 2
  plus: formula.double + 1
  loop: formula.loop
  late: due < today()
views:
  - type: table
    name: T
    filters: file.inFolder("tasks")
    order: [file.name, formula.double, formula.plus, formula.loop, formula.late]
    sort:
      - property: file.name
        direction: ASC
`);
    const byName = Object.fromEntries(r.groups[0]!.rows.map((x) => [x.title, x.values]));
    expect(byName.A).toMatchObject({ "formula.double": 20, "formula.plus": 21, "formula.loop": null, "formula.late": false });
    expect(byName.B).toMatchObject({ "formula.late": true });
    expect(r.warnings).toContain('formula "loop" refers to itself');
  });
});

describe("sort", () => {
  test("numbers sort numerically, empty values last in both directions", () => {
    const asc = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: status\n        direction: ASC\n      - property: n\n        direction: DESC\n    order: [status, n]\n');
    expect(paths(asc)).toEqual(["tasks/B.md", "tasks/C.md", "tasks/A.md", "tasks/D.md"]);
    const num = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: n\n        direction: ASC\n');
    expect(paths(num)).toEqual(["tasks/B.md", "tasks/D.md", "tasks/A.md", "tasks/C.md"]);
    const desc = q('views:\n  - type: table\n    name: T\n    sort:\n      - property: status\n        direction: DESC\n');
    expect(paths(desc).slice(-2).sort()).toEqual(["people/Ann.md", "tasks/D.md"]);
  });

  test("dates and file properties", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: due\n        direction: ASC\n');
    expect(paths(r).slice(0, 2)).toEqual(["tasks/B.md", "tasks/A.md"]);
    const bySize = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: file.size\n        direction: DESC\n');
    expect(paths(bySize)[0]).toBe("tasks/C.md");
  });
});

describe("groupBy", () => {
  const src = (extra = "") =>
    `filters: file.inFolder("tasks")\nviews:\n  - type: kanban\n    name: B\n    groupBy:\n      property: status\n      direction: ASC\n${extra}    order: [file.name]\n`;

  test("groups in order, empty value last as No value", () => {
    const r = q(src());
    expect(r.groups.map((g) => [g.key, g.label, g.count])).toEqual([
      ["Doing", "Doing", 1],
      ["Done", "Done", 1],
      ["Todo", "Todo", 1],
      [null, "No value", 1],
    ]);
  });

  test("groupOrder wins, includes empty groups, the rest follows", () => {
    const r = q(src("    groupOrder: [Todo, Blocked, Doing]\n"));
    expect(r.groups.map((g) => [g.key, g.count])).toEqual([["Todo", 1], ["Blocked", 0], ["Doing", 1], ["Done", 1], [null, 1]]);
  });

  test("DESC reverses the unlisted groups but keeps No value last", () => {
    const r = q(src().replace("ASC", "DESC"));
    expect(r.groups.map((g) => g.key)).toEqual(["Todo", "Done", "Doing", null]);
  });

  test("a link property cannot leak its target through a group key", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: owner\n', { allowed: NO_SECRET });
    expect(r.groups.map((g) => [g.key, g.count])).toEqual([["[[people/Ann]]", 2], [null, 2]]);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  test("numbers group numerically ordered", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: n\n      direction: ASC\n');
    expect(r.groups.map((g) => g.key)).toEqual(["2", "5", "10", "33"]);
  });
});

describe("step budget", () => {
  test("the budget is per note: a long filter over 8000 notes keeps every row", () => {
    const many = Array.from({ length: 8000 }, (_, i) => entry(`bulk/n${i}.md`, { status: "Todo", n: i }));
    const filter = 'status == "Todo" && n >= 0 && (n < 100000 || n > 200000) && !(status == "Done") && file.inFolder("bulk")';
    const r = q(`filters: '${filter}'\nviews:\n  - type: table\n    name: T\n`, {
      idx: index({ entries: () => many }),
      req: { limit: 2000 },
    });
    expect(r.total).toBe(8000);
    expect(r.warnings).toEqual([]);
  });
});

describe("limit and paging", () => {
  const src = 'filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    limit: 3\n    sort:\n      - property: file.name\n        direction: ASC\n';
  test("view limit caps total; offset and limit page the rest", () => {
    expect(q(src).total).toBe(3);
    const p = q(src, { req: { offset: 1, limit: 1 } });
    expect(paths(p)).toEqual(["tasks/B.md"]);
    expect(p.total).toBe(3);
  });

  test("request limit is clamped to 1..2000 and defaults to 500", () => {
    const big = Array.from({ length: 2100 }, (_, i) => entry(`bulk/n${i}.md`, {}));
    const idx = index({ entries: () => big });
    expect(paths(q("", { idx, req: { limit: 99999 } }))).toHaveLength(2000);
    expect(paths(q("", { idx }))).toHaveLength(500);
    expect(q("", { idx, req: { limit: 0 } }).groups[0]!.rows).toHaveLength(1);
  });

  test("grouped paging keeps whole-group counts", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: status\n', { req: { offset: 1, limit: 1 } });
    expect(r.total).toBe(4);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ key: "Done", count: 1 });
  });
});

describe("file values", () => {
  test("every documented file.* column", () => {
    const r = q('filters: file.hasLink("A")\nviews:\n  - type: table\n    name: T\n    order: [file.name, file.basename, file.fullname, file.path, file.folder, file.ext, file.size, file.tags, file.links, file.embeds, file.backlinks, file.ctime, file.mtime, file.properties]\n');
    const v = r.groups[0]!.rows[0]!.values;
    expect(v["file.name"]).toBe("B.md");
    expect(v["file.basename"]).toBe("B");
    expect(v["file.fullname"]).toBe("B.md");
    expect(v["file.folder"]).toBe("tasks");
    expect(v["file.ext"]).toBe("md");
    expect(v["file.size"]).toBe(100);
    expect(v["file.tags"]).toEqual(["work", "urgent"]);
    expect(v["file.links"]).toEqual(["[[tasks/A]]", "[[secret/S]]"]);
    expect(v["file.embeds"]).toEqual([]);
    expect(v["file.ctime"]).toBe("2026-10-01T00:00:00.000Z");
    expect(v["file.properties"]).toEqual({ status: "Doing", n: 2, due: "2026-11-01" });
  });

  test("backlinks come from the index", () => {
    const r = q('filters: file.name == "A.md"\nviews:\n  - type: table\n    name: T\n    order: [file.backlinks]\n');
    expect(r.groups[0]!.rows[0]!.values["file.backlinks"]).toEqual(["[[tasks/B]]"]);
  });
});

describe("cards cover property", () => {
  test("is in values but not in columns", () => {
    const r = q('filters: file.name == "A.md"\nviews:\n  - type: cards\n    name: C\n    image: owner\n    order: [file.name]\n');
    expect(r.columns.map((c) => c.key)).toEqual(["file.name"]);
    expect(r.groups[0]!.rows[0]!.values.owner).toBe("[[people/Ann]]");
  });
});

describe("permissions", () => {
  test("rows the caller cannot read never appear, and do not count", () => {
    const r = q('filters: status == "Todo"\n', { allowed: NO_SECRET });
    expect(paths(r).sort()).toEqual(["tasks/A.md", "views/V.md"]);
    expect(r.total).toBe(2);
  });

  test("link-valued cells drop unreadable targets: file.links, backlinks, link properties", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    order: [file.name, file.links, owner]\n    sort:\n      - property: file.name\n        direction: ASC\n', { allowed: NO_SECRET });
    const rows = Object.fromEntries(r.groups[0]!.rows.map((x) => [x.title, x.values]));
    expect(rows.B!["file.links"]).toEqual(["[[tasks/A]]"]);
    expect(rows.A!.owner).toBe("[[people/Ann]]");
    expect(rows.D!.owner).toEqual(["[[people/Ann]]"]);
    expect(JSON.stringify(r)).not.toContain("secret");
    const bl = q('filters: file.name == "A.md"\nviews:\n  - type: table\n    name: T\n    order: [file.backlinks]\n', { allowed: (p) => p !== "tasks/B.md" });
    expect(bl.groups[0]!.rows[0]!.values["file.backlinks"]).toEqual([]);
  });

  test("filters over backlinks cannot count unreadable sources", () => {
    const r = q("filters: file.backlinks.length > 0\n", { allowed: NO_SECRET });
    expect(paths(r)).toEqual(["tasks/A.md"]);
    const none = q("filters: file.backlinks.length > 0\n", { allowed: (p) => !p.startsWith("secret/") && p !== "tasks/B.md" });
    expect(paths(none)).toEqual([]);
  });

  test("a caller with no read access gets no rows", () => {
    expect(q("", { allowed: () => false }).total).toBe(0);
  });

  test("a values object with a __proto__ column does not pollute", () => {
    const r = q('views:\n  - type: table\n    name: T\n    order: ["__proto__", file.name]\n');
    expect(Object.getPrototypeOf(r.groups[0]!.rows[0]!.values)).toBeNull();
  });
});

describe("robustness", () => {
  test("a formula column with a non-finite date is null, not an error", () => {
    const r = q('formulas:\n  bad: date("2026-11-26T25:99Z")\n  far: now() + "99999999999999 hours"\nfilters: file.name == "A.md"\nviews:\n  - type: table\n    name: T\n    order: [file.name, formula.bad, formula.far]\n');
    expect(r.groups[0]!.rows[0]!.values).toMatchObject({ "formula.bad": null, "formula.far": null });
  });

  test("a budget hit inside a formula drops the note, even under not", () => {
    const ones = Array.from({ length: 300 }, () => "1").join(" + ");
    const parts = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const defs = parts.map((f) => `  ${f}: ${ones}\n`).join("");
    const sum = parts.map((f) => `formula.${f}`).join(" + ");
    const src = `formulas:\n${defs}  heavy: ${sum}\nfilters:\n  not:\n    - formula.heavy > 1\nviews:\n  - type: table\n    name: T\n`;
    const r = q(src);
    expect(r.total).toBe(0);
    expect(r.warnings.some((w) => w.includes("budget"))).toBe(true);
  });

  test("null summaries, columnSize and views count as empty; NaN paging falls back", () => {
    const r = q("summaries:\ncolumnSize:\nviews:\n", { req: { limit: Number.NaN, offset: Number.NaN } });
    expect(r.view).toBe("Table");
    expect(r.total).toBe(6 + 1);
    const v = q("views:\n  - type: table\n    name: T\n    summaries:\n    columnSize:\n");
    expect(v.view).toBe("T");
  });
});
