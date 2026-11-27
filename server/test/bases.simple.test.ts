import { describe, expect, test } from "bun:test";
import { parseBase } from "../src/bases/parse";
import { simpleBase } from "../src/bases/simple";

describe("simpleBase", () => {
  test("round trips through the parser", () => {
    const src = simpleBase({
      filter: 'status == "Todo" && !file.hasTag("x")',
      columns: ["file.name", "status"],
      sort: [{ property: "n", direction: "DESC" }],
    });
    const v = parseBase(src).config.views[0]!;
    expect(v.filters).toBe('status == "Todo" && !file.hasTag("x")');
    expect(v.order).toEqual(["file.name", "status"]);
    expect(v.sort).toEqual([{ property: "n", direction: "DESC" }]);
  });

  test("an expression YAML would misread is still read back whole", () => {
    for (const f of ["!x", "a: b", "x # y", "- z", "[1]"]) {
      expect(parseBase(simpleBase({ filter: f })).config.views[0]!.filters).toBe(f);
    }
  });

  test("no arguments gives a default table", () => {
    expect(parseBase(simpleBase({})).config.views[0]).toMatchObject({ type: "table", name: "Query", order: [], sort: [] });
  });
});
