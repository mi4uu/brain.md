import { describe, expect, test } from "bun:test";
import type { GraphInput } from "../src/graph/engine";
import { DEFAULT_FILTER, filterGraph, localGraph } from "../src/graph/filter";

const g: GraphInput = {
  nodes: [
    { id: "a.md", title: "Alpha", folder: "", tags: ["x"] },
    { id: "work/b.md", title: "Beta", folder: "work", tags: ["X", "y"] },
    { id: "work/c.md", title: "Gamma", folder: "work", tags: [] },
    { id: "d.md", title: "Delta", folder: "", tags: [] },
    { id: "lone.md", title: "Lone", folder: "", tags: [] },
  ],
  links: [
    { source: "a.md", target: "work/b.md" },
    { source: "work/b.md", target: "work/c.md" },
    { source: "work/c.md", target: "d.md" },
  ],
};

const ids = (x: GraphInput) => x.nodes.map((n) => n.id).sort();

describe("filterGraph", () => {
  test("default keeps everything", () => {
    expect(filterGraph(g, DEFAULT_FILTER)).toEqual(g);
  });

  test("folder filter keeps only that folder and links inside it", () => {
    const r = filterGraph(g, { ...DEFAULT_FILTER, folder: "work" });
    expect(ids(r)).toEqual(["work/b.md", "work/c.md"]);
    expect(r.links).toEqual([{ source: "work/b.md", target: "work/c.md" }]);
  });

  test("tag filter is case-insensitive", () => {
    expect(ids(filterGraph(g, { ...DEFAULT_FILTER, tag: "x" }))).toEqual(["a.md", "work/b.md"]);
  });

  test("hiding unlinked notes judges links after the other filters", () => {
    expect(ids(filterGraph(g, { ...DEFAULT_FILTER, orphans: false }))).toEqual(["a.md", "d.md", "work/b.md", "work/c.md"]);
    expect(ids(filterGraph(g, { ...DEFAULT_FILTER, tag: "x", orphans: false }))).toEqual(["a.md", "work/b.md"]);
    expect(ids(filterGraph(g, { ...DEFAULT_FILTER, folder: "", orphans: false }))).toEqual([]);
  });

  test("query matches title or path", () => {
    expect(ids(filterGraph(g, { ...DEFAULT_FILTER, query: "gam" }))).toEqual(["work/c.md"]);
    expect(ids(filterGraph(g, { ...DEFAULT_FILTER, query: "work/" }))).toEqual(["work/b.md", "work/c.md"]);
  });
});

describe("localGraph", () => {
  test("depth 1 and 2 around a note", () => {
    expect(ids(localGraph(g, "a.md", 1))).toEqual(["a.md", "work/b.md"]);
    expect(ids(localGraph(g, "a.md", 2))).toEqual(["a.md", "work/b.md", "work/c.md"]);
  });

  test("a note without links is alone", () => {
    expect(localGraph(g, "lone.md", 2)).toEqual({ nodes: [g.nodes[4]!], links: [] });
  });
});
