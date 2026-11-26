import { describe, expect, test } from "bun:test";
import { readFrontmatter, setProperties, renameProperty, FrontmatterError } from "@brainmd/shared/frontmatter";

const wrap = (y: string, eol = "\n") => `---${eol}${y}${eol}---${eol}body${eol}`;

test("scalar replace keeps comment, odd spacing, 007", () => {
  const src = wrap("# top\nid: 007\ntitle:   Foo  # why\nstatus: todo");
  const out = setProperties(src, { title: "Bar" });
  expect(out).toBe(wrap("# top\nid: 007\ntitle:   Bar  # why\nstatus: todo"));
});
test("crlf block list replace", () => {
  const src = wrap("tags:\r\n- a\r\n- b\r\nx: 1", "\r\n");
  const out = setProperties(src, { tags: ["a", "c", "d"] });
  expect(out).toBe(wrap("tags:\r\n- a\r\n- c\r\n- d\r\nx: 1", "\r\n"));
});
test("indented block list", () => {
  const src = wrap("tags:\n    - a\n    - b\nx: 1");
  expect(setProperties(src, { tags: ["z"] })).toBe(wrap("tags:\n    - z\nx: 1"));
});
test("block list last pair no trailing newline in raw", () => {
  const src = wrap("x: 1\ntags:\n  - a\n  - b");
  expect(setProperties(src, { tags: ["q", "r"] })).toBe(wrap("x: 1\ntags:\n  - q\n  - r"));
});
test("flow list", () => {
  const src = wrap("tags: [x, y]  # c\nk: v");
  expect(setProperties(src, { tags: ["x", "y", "z"] })).toBe(wrap("tags: [x, y, z]  # c\nk: v"));
});
test("scalar -> list and list -> scalar", () => {
  expect(setProperties(wrap("a: 1\nb: x"), { b: ["p", "q"] })).toBe(wrap("a: 1\nb:\n  - p\n  - q"));
  expect(setProperties(wrap("b:\n  - p\n  - q\nc: 1"), { b: "s" })).toBe(wrap("b: s\nc: 1"));
  expect(setProperties(wrap("b:\r\n- p\r\n- q\r\nc: 1", "\r\n"), { b: "s" })).toBe(wrap("b: s\r\nc: 1", "\r\n"));
});
test("empty list", () => {
  expect(setProperties(wrap("b:\n  - p\nc: 1"), { b: [] })).toBe(wrap("b: []\nc: 1"));
});
test("append, wikilink quoting, types", () => {
  const out = setProperties(wrap("a: 1"), { link: "[[Note]]", n: 3, ok: true,  "my key": "v", d: "2026-11-26", s: "007" });
  expect(out).toBe(wrap('a: 1\nlink: "[[Note]]"\nn: 3\nok: true\nmy key: v\nd: 2026-11-26\ns: "007"'));
  expect(readFrontmatter(out).props).toEqual({ a: 1, link: "[[Note]]", n: 3, ok: true,  "my key": "v", d: "2026-11-26", s: "007" });
});
test("append list and nested", () => {
  const out = setProperties(wrap("a: 1"), { tags: ["x", "[[L]]"], m: { k: 1 } });
  expect(readFrontmatter(out).props).toEqual({ a: 1, tags: ["x", "[[L]]"], m: { k: 1 } });
  expect(out).toContain('tags:\n  - x\n  - "[[L]]"\nm:\n  k: 1');
});
test("unset middle, last, only", () => {
  expect(setProperties(wrap("a: 1\nb: 2\nc: 3"), {}, ["b"])).toBe(wrap("a: 1\nc: 3"));
  expect(setProperties(wrap("a: 1\nb: 2\nc: 3"), {}, ["c"])).toBe(wrap("a: 1\nb: 2"));
  expect(setProperties(wrap("a: 1\nb:\n  - x\n  - y"), {}, ["b"])).toBe(wrap("a: 1"));
  expect(setProperties(wrap("a: 1\r\nb: 2", "\r\n"), {}, ["b"])).toBe(wrap("a: 1", "\r\n"));
  expect(readFrontmatter(setProperties(wrap("a: 1"), {}, ["a"])).props).toEqual({});
});
test("unset last + append", () => {
  expect(setProperties(wrap("a: 1\nb: 2"), { c: 3 }, ["b"])).toBe(wrap("a: 1\nc: 3"));
});
test("unset+set same key sets", () => {
  expect(setProperties(wrap("a: 1"), { a: 2 }, ["a"])).toBe(wrap("a: 2"));
});
test("BOM", () => {
  const src = "\uFEFF" + wrap("a: 1");
  expect(setProperties(src, { a: 2 })).toBe("\uFEFF" + wrap("a: 2"));
  expect(readFrontmatter(src).range).toEqual({ from: 1, to: 1 + "---\na: 1\n---".length });
});
test("no frontmatter creates block", () => {
  expect(setProperties("hello\n", { a: 1 })).toBe("---\na: 1\n---\nhello\n");
  expect(setProperties("hello\r\n", { a: 1 })).toBe("---\r\na: 1\r\n---\r\nhello\r\n");
  expect(setProperties("hello\n", {})).toBe("hello\n");
});
test("null value key", () => {
  expect(setProperties(wrap("a:\nb: 1"), { a: "x" })).toBe(wrap("a: x\nb: 1"));
  expect(setProperties(wrap("a:\r\nb: 1", "\r\n"), { a: "x" })).toBe(wrap("a: x\r\nb: 1", "\r\n"));
  expect(setProperties(wrap("a:\nb: 1"), { a: ["x"] })).toBe(wrap("a:\n  - x\nb: 1"));
});
test("block scalar replaced", () => {
  expect(setProperties(wrap("d: |\n  line1\n  line2\nb: 1"), { d: "x" })).toBe(wrap("d: x\nb: 1"));
});
test("nested map preserved, read", () => {
  const src = wrap("m:\n  k: 1\n  j: [a]\nz: 1");
  expect(setProperties(src, { z: 2 })).toBe(wrap("m:\n  k: 1\n  j: [a]\nz: 2"));
  expect(readFrontmatter(src).props).toEqual({ m: { k: 1, j: ["a"] }, z: 1 });
});
test("multi-line string", () => {
  const out = setProperties(wrap("a: 1"), { n: "l1\nl2" });
  expect(readFrontmatter(out).props!.n).toBe("l1\nl2");
});
test("errors", () => {
  const bad = wrap("a: [1\nb: : :");
  expect(readFrontmatter(bad).error).toBeString();
  expect(() => setProperties(bad, { a: 1 })).toThrow(FrontmatterError);
  try { setProperties(bad, { a: 1 }); } catch (e) { expect((e as FrontmatterError).code).toBe("INVALID_YAML"); }
  try { setProperties(wrap("- a\n- b"), { a: 1 }); } catch (e) { expect((e as FrontmatterError).code).toBe("NOT_A_MAPPING"); }
  expect(readFrontmatter(wrap("- a")).error).toBe("frontmatter must be YAML mapping");
  expect(readFrontmatter("no fm")).toEqual({ props: null, error: null, range: null });
});
test("comment-only block", () => {
  expect(setProperties(wrap("# just a comment"), { a: 1 })).toBe(wrap("# just a comment\na: 1"));
});
test("rename", () => {
  expect(renameProperty(wrap("old: 1 # c\nx: 2"), "old", "new")).toBe(wrap("new: 1 # c\nx: 2"));
  expect(renameProperty(wrap("old: 1\nnew: 2"), "old", "new")).toBe(wrap("old: 1\nnew: 2"));
  expect(renameProperty(wrap("a: 1"), "zz", "q")).toBe(wrap("a: 1"));
});
test("proto key safe", () => {
  const r = readFrontmatter(wrap("a: 1\n__proto__: x"));
  expect(Object.keys(r.props ?? {})).toEqual(["a"]);
});
test("null values render as empty", () => {
  expect(setProperties(wrap("a: x # c\nb: 1"), { a: null })).toBe(wrap("a: # c\nb: 1"));
  expect(setProperties(wrap("a: 1"), { n: null })).toBe(wrap("a: 1\nn:"));
  expect(setProperties(wrap("a:\n  - x\nb: 1"), { a: null })).toBe(wrap("a:\nb: 1"));
  expect(readFrontmatter(setProperties(wrap("a: 1"), { n: null, m: 2 })).props).toEqual({ a: 1, n: null, m: 2 });
  expect(setProperties(wrap("a:\nb: 1"), { a: null })).toBe(wrap("a:\nb: 1"));
});
test("unset keeps comment lines that belong to the next key", () => {
  expect(setProperties(wrap("a: 1\nb: 2\n# about c\nc: 3"), {}, ["b"])).toBe(wrap("a: 1\n# about c\nc: 3"));
  expect(setProperties(wrap("a: 1\nb:\n  - x # t\n# about c\nc: 3"), {}, ["b"])).toBe(wrap("a: 1\n# about c\nc: 3"));
  expect(setProperties(wrap("a: 1\r\nb: 2\r\n# about c\r\nc: 3", "\r\n"), {}, ["b"])).toBe(wrap("a: 1\r\n# about c\r\nc: 3", "\r\n"));
});
test("unset several trailing keys leaves no blank line", () => {
  expect(setProperties(wrap("a: 1\nb: 2\nc: 3"), {}, ["b", "c"])).toBe(wrap("a: 1"));
  expect(setProperties(wrap("a: 1\r\nb: 2\r\nc: 3", "\r\n"), {}, ["b", "c"])).toBe(wrap("a: 1", "\r\n"));
  expect(setProperties(wrap("a: 1\nb: 2\nc: 3"), {}, ["a", "b", "c"])).toBe("---\n\n---\nbody\n");
  expect(setProperties(wrap("a: 1\nb: 2\nc: 3"), { d: 4 }, ["b", "c"])).toBe(wrap("a: 1\nd: 4"));
});

test("unset removes keys named like Object.prototype members", () => {
  expect(setProperties(wrap("constructor: x\ntoString: y\na: 1"), {}, ["constructor", "toString"])).toBe(wrap("a: 1"));
});

const aliasBomb = (() => {
  let y = "a: &a [x,x,x,x,x,x,x,x,x,x]\n";
  for (let i = 0; i < 12; i++) y += `b${i}: &b${i} [${Array(10).fill(i === 0 ? "*a" : `*b${i - 1}`).join(",")}]\n`;
  return wrap(y.trimEnd());
})();

describe("aliases that do not resolve", () => {
  test("readFrontmatter reports them instead of throwing", () => {
    for (const src of [wrap("note: *important*"), wrap("status: draft\nnext: *todo"), aliasBomb]) {
      const r = readFrontmatter(src);
      expect(r.props).toBeNull();
      expect(r.error).toBeString();
      expect(r.range).not.toBeNull();
    }
  });
  test("setProperties and renameProperty refuse them as INVALID_YAML", () => {
    for (const src of [wrap("note: *important*"), aliasBomb]) {
      for (const f of [() => setProperties(src, { z: 1 }), () => renameProperty(src, "note", "n")]) {
        expect(f).toThrow(FrontmatterError);
        try { f(); } catch (e) { expect((e as FrontmatterError).code).toBe("INVALID_YAML"); }
      }
    }
  });
});

const code = (f: () => unknown): string | null => {
  try { f(); return null; } catch (e) { return e instanceof FrontmatterError ? e.code : `not a FrontmatterError: ${String(e)}`; }
};

describe("edits that would lose or corrupt other properties are refused", () => {
  const flow = wrap("{a: 1, b: 2}");
  test("a flow-style root mapping", () => {
    expect(readFrontmatter(flow).props).toEqual({ a: 1, b: 2 });
    expect(code(() => setProperties(flow, {}, ["a"]))).toBe("INVALID_YAML");
    expect(code(() => setProperties(flow, { c: 3 }))).toBe("INVALID_YAML");
    expect(code(() => setProperties(flow, { a: ["x", "y"] }))).toBe("INVALID_YAML");
    expect(code(() => setProperties(wrap("{}"), { a: 1 }))).toBe("INVALID_YAML");
  });
  test("unset or null of an anchored key that another key aliases", () => {
    const src = wrap("base: &b hello\ncopy: *b\nz: 1");
    expect(code(() => setProperties(src, {}, ["base"]))).toBe("INVALID_YAML");
    expect(code(() => setProperties(src, { base: null }))).toBe("INVALID_YAML");
  });
  test("a set that would change an aliasing key", () => {
    expect(code(() => setProperties(wrap("base: &b hello\ncopy: *b"), { base: "bye" }))).toBe("INVALID_YAML");
  });
  test("edits that leave every other key alone still go through", () => {
    const src = wrap("base: &b hello\ncopy: *b\nz: 1");
    expect(setProperties(src, { z: 2 })).toBe(wrap("base: &b hello\ncopy: *b\nz: 2"));
    expect(setProperties(src, { base: "bye", copy: "bye" })).toBe(wrap("base: &b bye\ncopy: bye\nz: 1"));
    expect(setProperties(src, {}, ["copy"])).toBe(wrap("base: &b hello\nz: 1"));
  });
  test("the error tells the caller to edit in source", () => {
    expect(() => setProperties(flow, { c: 3 })).toThrow(/edit in source/);
  });
});

test("flow list items with flow indicators are quoted", () => {
  const out = setProperties(wrap("tags: [x]"), { tags: ["x", "a, b", "c]", "{d}"] });
  expect(readFrontmatter(out).props).toEqual({ tags: ["x", "a, b", "c]", "{d}"] });
});

test("a property named error is an ordinary property", () => {
  expect(readFrontmatter(wrap("error: x"))).toMatchObject({ props: { error: "x" }, error: null });
  expect(setProperties(wrap("error: x"), { error: "y" })).toBe(wrap("error: y"));
});
