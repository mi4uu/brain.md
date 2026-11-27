import { describe, expect, test } from "bun:test";
import { runBaseQuery, type QueryDeps, type QueryEntry, type QueryIndex } from "../src/bases/query";
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

function q(source: string, o: { allowed?: (p: string) => boolean; req?: object; idx?: QueryIndex; deps?: Partial<QueryDeps> } = {}) {
  return runBaseQuery({ source, ...o.req }, { index: o.idx ?? index(), allowed: o.allowed ?? ALL, types: TYPES, now: NOW, ...o.deps });
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

  test("rows flag the cells the server altered", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    order: [file.name, owner]\n', { allowed: NO_SECRET });
    const flagged = r.groups[0]!.rows.filter((x) => x.partial);
    expect(flagged.length).toBeGreaterThan(0);
    for (const row of flagged) expect(row.partial).toEqual(["owner"]);
    const clean = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    order: [file.name, owner]\n');
    expect(clean.groups[0]!.rows.every((x) => x.partial === undefined)).toBe(true);
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

describe("group property values", () => {
  test("rides along in values and partial without being a column", () => {
    const r = q('filters: file.name == "A.md"\nviews:\n  - type: table\n    name: T\n    order: [file.name]\n    groupBy:\n      property: owner\n      direction: ASC\n');
    expect(r.columns.map((c) => c.key)).toEqual(["file.name"]);
    expect(r.groups[0]!.rows[0]!.values.owner).toBe("[[people/Ann]]");
  });
  test("a cut value is flagged partial", () => {
    const r = q('filters: file.name == "D.md"\nviews:\n  - type: table\n    name: T\n    order: [file.name]\n    groupBy:\n      property: owner\n      direction: ASC\n', { allowed: NO_SECRET });
    const row = r.groups[0]!.rows[0]!;
    expect(row.values.owner).toEqual(["[[people/Ann]]"]);
    expect(row.partial).toEqual(["owner"]);
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
    expect(paths(r)).toHaveLength(7);
    const v = q("views:\n  - type: table\n    name: T\n    summaries:\n    columnSize:\n");
    expect(v.view).toBe("T");
  });
});

describe("robustness, round 2", () => {
  test("a doubling formula chain over many notes is capped, quick and warns", () => {
    const many = Array.from({ length: 300 }, (_, i) => entry(`bulk/n${i}.md`, { n: i }));
    const defs = ["  f0: '\"xxxxxxxxxx\"'"];
    for (let i = 1; i <= 24; i++) defs.push(`  f${i}: formula.f${i - 1} + formula.f${i - 1}`);
    const src = `formulas:\n${defs.join("\n")}\nfilters: formula.f24.length > 0\nviews:\n  - type: table\n    name: T\n    order: [file.name, formula.f24]\n`;
    const t0 = performance.now();
    const r = q(src, { idx: index({ entries: () => many }) });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(r.total).toBe(0);
    expect(r.warnings.some((w) => w.includes("dropped"))).toBe(true);
  });

  test("a budget hit inside a column formula keeps the row with an empty cell", () => {
    const ones = Array.from({ length: 300 }, () => "1").join(" + ");
    const parts = Array.from({ length: 20 }, (_, i) => `f${i}`);
    const defs = parts.map((f) => `  ${f}: ${ones}\n`).join("");
    const sum = parts.map((f) => `formula.${f}`).join(" + ");
    const r = q(`formulas:\n${defs}  heavy: ${sum}\nfilters: file.name == "A.md"\nviews:\n  - type: table\n    name: T\n    order: [file.name, formula.heavy]\n`);
    expect(r.total).toBe(1);
    expect(r.groups[0]!.rows[0]!.values).toMatchObject({ "file.name": "A.md", "formula.heavy": null });
  });

  test("an index that throws gives the generic response", () => {
    const orig = console.error;
    console.error = () => {};
    try {
      const r = q("", { idx: index({ entries: () => { throw new Error("boom"); } }) });
      expect(r.total).toBe(0);
      expect(r.warnings).toContain("the view could not be evaluated");
    } finally {
      console.error = orig;
    }
  });

  test("declared empty groups appear on the first page only", () => {
    const src = 'filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: status\n    groupOrder: [Blocked]\n';
    expect(q(src, { req: { offset: 0, limit: 1 } }).groups.some((g) => g.key === "Blocked")).toBe(true);
    expect(q(src, { req: { offset: 1, limit: 1 } }).groups.some((g) => g.key === "Blocked")).toBe(false);
  });
});

describe("robustness, round 3", () => {
  const manyNotes = (n: number) => Array.from({ length: n }, (_, i) => entry(`bulk/n${i}.md`, { n: i }));

  const bigChain = () => {
    const defs = ['  f0: \'"xxxxxxxxxx"\''];
    for (let i = 1; i <= 13; i++) defs.push(`  f${i}: formula.f${i - 1} + formula.f${i - 1}`);
    return defs;
  };

  test("string functions cost steps by input length", () => {
    const calls = Array.from({ length: 230 }, (_, i) => (i % 2 ? ".upper()" : ".lower()")).join("");
    const defs = [...bigChain(), `  s: formula.f13${calls}`];
    const src = `formulas:\n${defs.join("\n")}\nfilters: formula.s.length > 0\nviews:\n  - type: table\n    name: T\n`;
    const t0 = performance.now();
    const r = q(src, { idx: index({ entries: () => manyNotes(200) }) });
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r.total).toBe(0);
    expect(r.warnings.some((w) => w.includes("budget"))).toBe(true);
  });

  test("a formula used in the filter and as a column is charged once", () => {
    const ones = Array.from({ length: 300 }, () => "1").join(" + ");
    const parts = Array.from({ length: 12 }, (_, i) => `f${i}`);
    const defs = parts.map((f) => `  ${f}: ${ones}\n`).join("");
    const sum = parts.map((f) => `formula.${f}`).join(" + ");
    const r = q(`formulas:\n${defs}  heavy: ${sum}\nfilters: formula.heavy > 1\nviews:\n  - type: table\n    name: T\n    order: [file.name, formula.heavy]\n`);
    expect(r.total).toBeGreaterThan(0);
    expect(r.groups[0]!.rows[0]!.values["formula.heavy"]).toBe(3600);
    expect(r.warnings).toEqual([]);
  });

  test("large cells are cut and the response is bounded", () => {
    const cols = Array.from({ length: 20 }, (_, i) => `  c${i}: formula.f13 + "${i}"`);
    const defs = [...bigChain(), ...cols];
    const src = `formulas:\n${defs.join("\n")}\nviews:\n  - type: table\n    name: T\n    order: [${cols.map((_, i) => `formula.c${i}`).join(", ")}]\n`;
    const r = q(src, { idx: index({ entries: () => manyNotes(1000) }), req: { limit: 1000 } });
    expect(JSON.stringify(r).length).toBeLessThan(8_000_000);
    expect(r.groups[0]!.rows[0]!.values["formula.c0"]).toHaveLength(10000);
    expect(r.warnings.some((w) => w.includes("too large"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("cut"))).toBe(true);
    const rows = r.groups[0]!.rows;
    expect(rows[0]!.partial).toContain("formula.c0");
    expect(rows.some((x) => x.partial?.length === 20)).toBe(true);
  });
});

describe("robustness, round 4", () => {
  const manyNotes = (n: number) => Array.from({ length: n }, (_, i) => entry(`bulk/n${i}.md`, { n: i }));
  const chain9 = () => {
    const defs = ['  f0: \'"xxxxxxxxxx"\''];
    for (let i = 1; i <= 9; i++) defs.push(`  f${i}: formula.f${i - 1} + formula.f${i - 1}`);
    return defs;
  };
  const wide = (order: string) => {
    const g = Array.from({ length: 5 }, (_, i) => `  g${i}: (formula.f9 + formula.f9 + "${i}").lower()`);
    const f = Array.from({ length: 5 }, (_, i) => `    - formula.g${i}.length > 0`);
    return `formulas:\n${[...chain9(), ...g].join("\n")}\nfilters:\n  and:\n${f.join("\n")}\n    - formula.f6.length > 0\nviews:\n  - type: table\n    name: T\n    order: [${order}]\n`;
  };

  test("only small values a later phase reads are kept between phases", () => {
    const stats = { valuesPeak: 0, keysPeak: 0 };
    const r = q(wide("file.name"), { idx: index({ entries: () => manyNotes(300) }), req: { limit: 1 }, deps: { stats } });
    expect(r.total).toBe(300);
    expect(stats.valuesPeak).toBe(0);
    const big = { valuesPeak: 0, keysPeak: 0 };
    const r2 = q(wide("file.name, formula.f6, formula.f9"), { idx: index({ entries: () => manyNotes(300) }), req: { limit: 1 }, deps: { stats: big } });
    expect(r2.total).toBe(300);
    expect(r2.groups[0]!.rows[0]!.values["formula.f9"]).toHaveLength(5120);
    // f0..f6 (1270 chars) stay because f9 reads them; f7..f9 are over 1000 and are computed again for the page row.
    expect(big.valuesPeak).toBeGreaterThan(300 * 1270);
    expect(big.valuesPeak).toBeLessThan(300 * 2000);
    expect(r2.warnings).toEqual([]);
  });

  test("a filter formula read by a column formula is charged once", () => {
    const ones = Array.from({ length: 300 }, () => "1").join(" + ");
    const parts = Array.from({ length: 12 }, (_, i) => `f${i}`);
    const defs = parts.map((f) => `  ${f}: ${ones}\n`).join("");
    const sum = parts.map((f) => `formula.${f}`).join(" + ");
    const r = q(`formulas:\n${defs}  heavy: ${sum}\n  half: formula.heavy / 2\nfilters: formula.heavy > 1\nviews:\n  - type: table\n    name: T\n    order: [file.name, formula.half]\n`);
    expect(r.total).toBeGreaterThan(0);
    expect(r.groups[0]!.rows[0]!.values["formula.half"]).toBe(1800);
    expect(r.warnings).toEqual([]);
  });

  test("kept formula values stay under a query-wide cap; capped rows still get their values", () => {
    const stats = { valuesPeak: 0, keysPeak: 0 };
    const r = q(wide("file.name, formula.f6"), { idx: index({ entries: () => manyNotes(300) }), req: { limit: 300 }, deps: { stats, retainCap: { values: 50_000 } } });
    expect(r.total).toBe(300);
    expect(stats.valuesPeak).toBeGreaterThan(0);
    expect(stats.valuesPeak).toBeLessThanOrEqual(50_000);
    expect(r.groups[0]!.rows.every((row) => (row.values["formula.f6"] as string).length === 640)).toBe(true);
    expect(r.warnings.some((w) => w.includes("computed again"))).toBe(true);
  });

  test("sort and group keys count against the cap and are left empty past it", () => {
    const stats = { valuesPeak: 0, keysPeak: 0 };
    const src = `formulas:\n${chain9().join("\n")}\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: formula.f6\n    groupBy:\n      property: formula.f5\n`;
    const r = q(src, { idx: index({ entries: () => manyNotes(300) }), req: { limit: 1 }, deps: { stats, retainCap: { keys: 50_000 } } });
    expect(r.total).toBe(300);
    expect(stats.keysPeak).toBeGreaterThan(0);
    expect(stats.keysPeak).toBeLessThanOrEqual(50_000);
    expect(r.warnings.some((w) => w.includes("left empty"))).toBe(true);
  });

  test("sort keys keep their order when kept formula values fill their own cap", () => {
    const src = wide("file.name, formula.f6").replace("    order:", "    sort:\n      - property: n\n        direction: DESC\n    order:");
    const stats = { valuesPeak: 0, keysPeak: 0 };
    const r = q(src, { idx: index({ entries: () => manyNotes(300) }), req: { limit: 5 }, deps: { stats, retainCap: { values: 50_000 } } });
    expect(paths(r)[0]).toBe("bulk/n299.md");
    expect(r.warnings.some((w) => w.includes("computed again"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("left empty"))).toBe(false);
  });

  test("a link built from a long string counts its text and is not kept", () => {
    const defs = ['  f0: \'"xxxxxxxxxx"\''];
    for (let i = 1; i <= 12; i++) defs.push(`  f${i}: formula.f${i - 1} + formula.f${i - 1}`);
    const src = `formulas:\n${defs.join("\n")}\n  L: link(formula.f12.lower())\nfilters: formula.L != null\nviews:\n  - type: table\n    name: T\n    order: [file.name, formula.L]\n    sort:\n      - property: formula.L\n`;
    const stats = { valuesPeak: 0, keysPeak: 0 };
    const r = q(src, { idx: index({ entries: () => manyNotes(300) }), req: { limit: 1 }, deps: { stats } });
    expect(r.total).toBe(300);
    // f0..f6 stay because L reads them; L itself (40960 chars) is not kept.
    expect(stats.valuesPeak).toBeLessThan(300 * 2000);
    expect(stats.keysPeak).toBeGreaterThanOrEqual(300 * 1000);
    expect(stats.keysPeak).toBeLessThan(300 * 1100);
  });

  test("string work is capped across the whole query", () => {
    const defs = ['  f0: \'"xxxxxxxxxx"\''];
    for (let i = 1; i <= 13; i++) defs.push(`  f${i}: formula.f${i - 1} + formula.f${i - 1}`);
    const head = `formulas:\n${defs.join("\n")}\n  L: formula.f13.lower()\n`;
    const deps = { stringWorkCap: 5_000_000 };
    // About 245k chars of string work per note: the first notes pass, the rest get the budget treatment.
    const filtered = q(`${head}filters: formula.L.length > 0\n`, { idx: index({ entries: () => manyNotes(300) }), deps });
    expect(filtered.total).toBeGreaterThan(0);
    expect(filtered.total).toBeLessThan(300);
    expect(filtered.warnings.some((w) => w.includes("budget"))).toBe(true);
    const sorted = q(`${head}views:\n  - type: table\n    name: T\n    sort:\n      - property: formula.L\n`, { idx: index({ entries: () => manyNotes(300) }), deps });
    expect(sorted.total).toBe(300);
    expect(sorted.warnings.some((w) => w.includes("budget"))).toBe(true);
    const free = q(`${head}filters: formula.L.length > 0\n`, { idx: index({ entries: () => manyNotes(10) }), deps });
    expect(free.total).toBe(10);
    expect(free.warnings).toEqual([]);
  });

  test("reading long text is free against the query-wide cap; only built text counts", () => {
    const desc = "a".repeat(2999) + "y";
    const notes = Array.from({ length: 16000 }, (_, i) => entry(`bulk/n${i}.md`, { n: i, description: desc }));
    const src = 'filters:\n  and:\n    - description.lower().contains("y")\n    - description.contains("y")\nviews:\n  - type: table\n    name: T\n    order: [file.name]\n    sort:\n      - property: n\n        direction: DESC\n    groupBy:\n      property: n\n';
    const r = q(src, { idx: index({ entries: () => notes }), req: { limit: 5 } });
    expect(r.total).toBe(16000);
    expect(r.warnings).toEqual([]);
  });

  test("a wall-clock deadline stops a heavy query early with one warning", () => {
    const desc = "a".repeat(3000);
    const notes = Array.from({ length: 16000 }, (_, i) => entry(`bulk/n${i}.md`, { n: i, description: desc }));
    const calls = Array.from({ length: 500 }, (_, i) => `    - description.contains("b${i}")`).join("\n");
    const src = `filters:\n  or:\n${calls}\n`;
    const t0 = performance.now();
    const r = q(src, { idx: index({ entries: () => notes }), deps: { deadlineMs: 1 } });
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(r.warnings).toEqual(["the query took too long; results are partial"]);
  });
});
