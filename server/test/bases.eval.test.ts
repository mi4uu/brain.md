import { describe, expect, test } from "bun:test";
import { DEFAULT_BUDGET, evaluate, type Scope } from "../src/bases/eval";
import { parseExpression } from "../src/bases/expr";
import { DateValue, addDuration, FileObject, FormulaRoot, toProp, type FileData, type FileHost, type Value } from "../src/bases/functions";

const NOW = new Date(2026, 10, 26, 9, 30);

function scope(over: Partial<FileData> = {}, extra: Partial<Scope> = {}, warnings: string[] = []): Scope {
  const data: FileData = {
    path: "work/Plan.md",
    size: 120,
    ctime: new Date(2026, 0, 2, 3, 4).getTime(),
    mtime: new Date(2026, 10, 20, 8, 0).getTime(),
    tags: ["project", "work/alpha"],
    props: { status: "Doing", n: 3, done: false, due: "2026-12-01", list: ["a", "b"], link: "[[Other]]" },
    ...over,
  };
  const host: FileHost = {
    resolveLink: (_f, t) => (t.toLowerCase() === "other" ? "work/Other.md" : undefined),
    outLinks: () => [{ text: "Other", path: "work/Other.md", embed: false }, { text: "pic.png", path: null, embed: true }],
    backlinks: () => ["a.md", "b.md"],
  };
  const file = new FileObject(data, host);
  return {
    now: NOW,
    warn: (m) => warnings.push(m),
    file,
    props: data.props,
    thisValue: { x: "T", file },
    formula: () => null,
    budget: { steps: 0, max: DEFAULT_BUDGET, hit: false },
    ...extra,
  };
}

function run(src: string, s: Scope = scope()): Value {
  const p = parseExpression(src);
  if (!p.ok) throw new Error(p.error);
  return evaluate(p.node, s);
}

describe("parser", () => {
  test("precedence and associativity", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("2 * 3 % 4")).toBe(2);
    expect(run("1 < 2 == true")).toBe(true);
    expect(run("true || false && false")).toBe(true);
    expect(run("!false && !false")).toBe(true);
    expect(run("-3 + 5")).toBe(2);
  });

  test("literals and string escapes", () => {
    expect(run('"a\\"b"')).toBe('a"b');
    expect(run("'it\\'s'")).toBe("it's");
    expect(run("1.5")).toBe(1.5);
    expect(run("null")).toBeNull();
  });

  test("errors never throw", () => {
    for (const bad of ["1 +", "(1", "a b", "x =>", "a ? b : c", '"open', "file.", "{a:1}", "f(1,)"]) {
      const p = parseExpression(bad);
      expect(p.ok).toBe(false);
    }
    expect(parseExpression("(".repeat(200) + "1" + ")".repeat(200)).ok).toBe(false);
    expect(parseExpression("1+".repeat(2000) + "1").ok).toBe(false);
  });
});

describe("evaluation: access", () => {
  test("bare names are note properties; prefixes", () => {
    expect(run("status")).toBe("Doing");
    expect(run("note.status")).toBe("Doing");
    expect(run('note["status"]')).toBe("Doing");
    expect(run("nope")).toBeNull();
    expect(run("this.x")).toBe("T");
    expect(run("this.file.name")).toBe("Plan.md");
  });

  test("file properties", () => {
    expect(run("file.name")).toBe("Plan.md");
    expect(run("file.basename")).toBe("Plan");
    expect(run("file.fullname")).toBe("Plan.md");
    expect(run("file.path")).toBe("work/Plan.md");
    expect(run("file.folder")).toBe("work");
    expect(run("file.ext")).toBe("md");
    expect(run("file.size < 200")).toBe(true);
    expect(run("file.tags.length")).toBe(2);
    expect(run("file.backlinks.length")).toBe(2);
    expect(run("file.links.length")).toBe(1);
    expect(run("file.embeds.length")).toBe(1);
    expect(run("file.nope")).toBeNull();
  });

  test("own properties only: prototype names read as null", () => {
    for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"]) {
      expect(run(`note["${k}"]`)).toBeNull();
      expect(run(`this["${k}"]`)).toBeNull();
      expect(run(`file["${k}"]`)).toBeNull();
    }
    const s = scope({ props: JSON.parse('{"__proto__": "own", "ok": 1}') });
    expect(run('note["__proto__"]', s)).toBe("own");
    expect(run("ok", s)).toBe(1);
  });

  test("method dispatch is a table, not obj[name]()", () => {
    const w: string[] = [];
    expect(run('status.constructor("x")', scope({}, {}, w))).toBeNull();
    expect(w).toEqual(['unsupported function "constructor"']);
    expect(run('"x".__proto__()', scope({}, {}, w))).toBeNull();
    expect(run("file.hasOwnProperty()", scope({}, {}, w))).toBeNull();
  });
});

describe("evaluation: operators", () => {
  test("comparison and equality", () => {
    expect(run('status == "Doing"')).toBe(true);
    expect(run('status != "Doing"')).toBe(false);
    expect(run("n >= 3 && n <= 3")).toBe(true);
    expect(run('n < "x"')).toBe(false);
    expect(run("missing == null")).toBe(true);
    expect(run("list == list")).toBe(true);
  });

  test("arithmetic corner cases", () => {
    expect(run("1 / 0")).toBeNull();
    expect(run("5 % 0")).toBeNull();
    expect(run('"a" + 1')).toBe("a1");
    expect(run('"a" + missing')).toBeNull();
    expect(run("n * 2")).toBe(6);
    expect(run("true + 1")).toBeNull();
  });

  test("short circuit does not evaluate the right side", () => {
    const w: string[] = [];
    run("false && nope()", scope({}, {}, w));
    expect(w).toEqual([]);
  });
});

describe("functions", () => {
  test("file functions", () => {
    expect(run('file.hasTag("project")')).toBe(true);
    expect(run('file.hasTag("#PROJECT")')).toBe(true);
    expect(run('file.hasTag("work")')).toBe(true);
    expect(run('file.hasTag("other", "work/alpha")')).toBe(true);
    expect(run('file.hasTag("wor")')).toBe(false);
    expect(run('file.inFolder("work")')).toBe(true);
    expect(run('file.inFolder("wor")')).toBe(false);
    expect(run('file.inFolder("")')).toBe(true);
    expect(run('file.hasLink("Other")')).toBe(true);
    expect(run('file.hasLink("[[other]]")')).toBe(true);
    expect(run('file.hasLink("Nope")')).toBe(false);
    expect(run('file.hasProperty("status")')).toBe(true);
    expect(run('file.hasProperty("constructor")')).toBe(false);
  });

  test("string functions", () => {
    expect(run('status.contains("oin")')).toBe(true);
    expect(run('status.containsAll("D", "g")')).toBe(true);
    expect(run('status.containsAny("x", "D")')).toBe(true);
    expect(run('status.startsWith("Do")')).toBe(true);
    expect(run('status.endsWith("ng")')).toBe(true);
    expect(run("status.isEmpty()")).toBe(false);
    expect(run('"  Hi ".trim().lower()')).toBe("hi");
    expect(run("status.upper()")).toBe("DOING");
    expect(run("status.length")).toBe(5);
  });

  test("list and any functions", () => {
    expect(run('list.contains("a")')).toBe(true);
    expect(run('list.containsAll("a", "b")')).toBe(true);
    expect(run('list.containsAny("z", "b")')).toBe(true);
    expect(run("list.isEmpty()")).toBe(false);
    expect(run("list.length")).toBe(2);
    expect(run("missing.isEmpty()")).toBe(true);
    expect(run("n.isTruthy()")).toBe(true);
    expect(run("missing.isTruthy()")).toBe(false);
    expect(run("n.toString()")).toBe("3");
    expect(run("list.toString()")).toBe("a, b");
  });

  test("if is lazy; link, date, now, today", () => {
    const w: string[] = [];
    expect(run('if(n > 2, "big", nope())', scope({}, {}, w))).toBe("big");
    expect(w).toEqual([]);
    expect(run('if(n > 5, "big")')).toBeNull();
    expect(toProp(run('link("Plan", "x")'))).toBe("[[Plan]]");
    expect(toProp(run("today()"))).toBe("2026-11-26");
    expect(toProp(run("now()"))).toMatch(/^2026-11-2[56]T/);
    expect(run('date("2026-02-30")')).toBeNull();
    expect(run('date("2026-12-01") == due')).toBe(true);
  });

  test("dates: compare, format, add and subtract durations", () => {
    expect(run("due > today()")).toBe(true);
    expect(run('due < today() + "3d"')).toBe(false);
    expect(run('due < today() + "1 week"')).toBe(true);
    expect(run('today() + "3d" == date("2026-11-29")')).toBe(true);
    expect(run('(today() - "1 week").format("YYYY-MM-DD")')).toBe("2026-11-19");
    expect(run('now().format("YYYY/MM/DD HH:mm")')).toBe("2026/11/26 09:30");
    expect(run('(today() + "1 month").format("MM")')).toBe("12");
    expect(run('today() + "2 hours"')).toBeInstanceOf(DateValue);
    expect(run('date("2026-12-01") - date("2026-11-30")')).toBe(86400000);
    const w: string[] = [];
    expect(run('today() + "soon"', scope({}, {}, w))).toBeNull();
    expect(w).toEqual(['invalid duration "soon"']);
  });

  test("unsupported function: null plus a warning, never a throw", () => {
    const w: string[] = [];
    expect(run('sum(1, 2) + "x"', scope({}, {}, w))).toBeNull();
    expect(run("list.map(1)", scope({}, {}, w))).toBeNull();
    expect(w).toEqual(['unsupported function "sum"', 'unsupported function "map"']);
  });

  test("formulas resolve through the scope", () => {
    const s = scope({}, { formula: (n) => (n === "double" ? 6 : null) });
    expect(run("formula.double + 1", s)).toBe(7);
    expect(run("formula.missing", s)).toBeNull();
    expect(new FormulaRoot()).toBeDefined();
  });
});

describe("step budget", () => {
  test("stops runaway evaluation with one warning", () => {
    const w: string[] = [];
    const s = scope({}, { budget: { steps: 0, max: 50, hit: false } }, w);
    const src = Array.from({ length: 80 }, () => "1").join(" + ");
    expect(run(src, s)).toBeNull();
    expect(run("1 + 1", s)).toBeNull();
    expect(w).toEqual(["evaluation budget exceeded for a note; its remaining expressions were skipped"]);
  });
});

describe("hardening", () => {
  test("non-finite dates and numbers evaluate to null", () => {
    expect(run('date("2026-11-26T25:99Z")')).toBeNull();
    expect(run('now() + "99999999999999 hours"')).toBeNull();
    expect(run('now() + "99999999999999999999999999999999999999 y"')).toBeNull();
    expect(toProp(new DateValue(Number.NaN, true))).toBeNull();
    expect(run("1e999")).toBeNull();
    expect(run("-1e999")).toBeNull();
    expect(run("1e308 * 10")).toBeNull();
    expect(run("1e308 + 1e308")).toBeNull();
    expect(run("1e999 + 1")).toBeNull();
    expect(toProp(Number.POSITIVE_INFINITY)).toBeNull();
  });

  test("the evaluator never throws on a null-prototype object or a failing formula", () => {
    const bare = Object.create(null) as Record<string, never>;
    const s = scope({ props: { o: bare as never } }, { formula: () => { throw new Error("boom"); } });
    expect(() => run('"a" + o', s)).not.toThrow();
    expect(() => run("formula.x", s)).not.toThrow();
    expect(run("formula.x", s)).toBeNull();
  });

  test("deepest parsable expression evaluates", () => {
    let parsed = 0;
    for (let depth = 1; depth < 80; depth++) {
      const p = parseExpression("(".repeat(depth) + "1" + ")".repeat(depth));
      if (p.ok) {
        parsed++;
        expect(evaluate(p.node, scope())).toBe(1);
      }
    }
    expect(parsed).toBeGreaterThan(10);
  });
});

describe("fix round 1", () => {
  test("I1: a nested evaluate that hits the budget poisons the outer result", () => {
    const w: string[] = [];
    const s = scope({}, {}, w);
    s.budget.max = 20;
    s.formula = () => {
      const p = parseExpression(Array.from({ length: 40 }, () => "1").join(" + "));
      if (!p.ok) throw new Error(p.error);
      return evaluate(p.node, s);
    };
    expect(run("!formula.x", s)).toBeNull();
    expect(w).toHaveLength(1);
  });

  test("I2/I3: durations are validated whole", () => {
    expect(toProp(run('today() + "-1 week"'))).toBe("2026-11-19");
    expect(toProp(run('today() - "-1 week"'))).toBe("2026-12-03");
    const w: string[] = [];
    expect(run('today() + "1          week oops"', scope({}, {}, w))).toBeNull();
    expect(run('today() + "1 week 2"', scope({}, {}, w))).toBeNull();
    expect(w).toHaveLength(2);
    expect(toProp(run('today() + "1 week, 2 days"'))).toBe("2026-12-05");
    const t0 = performance.now();
    expect(addDuration(new DateValue(0, false), `${"9".repeat(50000)} d`, 1)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });

  test("I4: fractional seconds parse and round trip", () => {
    const d = run('date("2026-11-26T10:00:00.000Z")');
    expect(d).toBeInstanceOf(DateValue);
    const iso = toProp(d) as string;
    expect(iso).toBe("2026-11-26T10:00:00.000Z");
    expect(run(`date("${iso}") == date("2026-11-26T10:00:00Z")`)).toBe(true);
    expect(run('date("2026-11-26T10:00:00.5")')).toBeInstanceOf(DateValue);
  });

  test("I5: date strings and links", () => {
    expect(toProp(run('due + "1 week"'))).toBe("2026-12-08");
    expect(run("due - today()")).toBe(5 * 86400000);
    expect(run('"x" + "1 week"')).toBe("x1 week");
    const s = scope({ props: { owner: "[[Other|Boss]]", rel: ["[[Elsewhere]]", "[[other]]"] } });
    expect(run('file.hasLink(link("Other"))', s)).toBe(true);
    expect(run('file.hasLink(link("Nope"))', s)).toBe(false);
    expect(run('owner == link("Other")', s)).toBe(true);
    expect(run('rel.contains(link("Other"))', s)).toBe(true);
    expect(run('rel.contains(link("Zed"))', s)).toBe(false);
    expect(run('file.links.contains(link("Other"))', s)).toBe(true);
    expect(run('link("work/Other.md") == link("Other")', s)).toBe(true);
  });

  test("minors: ranges, month clamp, ss, compare, root folder", () => {
    expect(run('date("2026-11-26T24:00")')).toBeNull();
    expect(run('date("2026-11-26T10:60")')).toBeNull();
    expect(run('date("0050-01-02")')).toBeInstanceOf(DateValue);
    expect(toProp(run('date("0050-01-02")'))).toBe("0050-01-02");
    expect(toProp(run('date("2026-01-31") + "1 month"'))).toBe("2026-02-28");
    expect(toProp(run('date("2024-02-29") + "1 year"'))).toBe("2025-02-28");
    expect(run('date("2026-11-26T01:02:03").format("HH:mm:ss")')).toBe("01:02:03");
    expect(run('"2026-12-02" > "2026-12-01"')).toBe(true);
    expect(run('"b" > "a"')).toBe(true);
    expect(run("file.folder", scope({ path: "Root.md" }))).toBe("/");
  });
});
