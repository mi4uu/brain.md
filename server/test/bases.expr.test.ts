import { describe, expect, test } from "bun:test";
import { parseExpression, type Node } from "../src/bases/expr";

function ast(src: string): Node {
  const r = parseExpression(src);
  if (!r.ok) throw new Error(r.error);
  return r.node;
}

const num = (v: number): Node => ({ t: "lit", v });
const id = (name: string): Node => ({ t: "id", name });

describe("parseExpression: shape", () => {
  test("literals", () => {
    expect(ast("1.5")).toEqual(num(1.5));
    expect(ast('"a\\"b"')).toEqual({ t: "lit", v: 'a"b' });
    expect(ast("'it\\'s'")).toEqual({ t: "lit", v: "it's" });
    expect(ast("true")).toEqual({ t: "lit", v: true });
    expect(ast("null")).toEqual({ t: "lit", v: null });
  });

  test("precedence and left associativity", () => {
    expect(ast("1 + 2 * 3")).toEqual({ t: "bin", op: "+", l: num(1), r: { t: "bin", op: "*", l: num(2), r: num(3) } });
    expect(ast("10 - 4 - 3")).toEqual({ t: "bin", op: "-", l: { t: "bin", op: "-", l: num(10), r: num(4) }, r: num(3) });
    expect(ast("a || b && c")).toEqual({ t: "bin", op: "||", l: id("a"), r: { t: "bin", op: "&&", l: id("b"), r: id("c") } });
    expect(ast("a < b == c")).toEqual({ t: "bin", op: "==", l: { t: "bin", op: "<", l: id("a"), r: id("b") }, r: id("c") });
    expect(ast("(1 + 2) * 3")).toEqual({ t: "bin", op: "*", l: { t: "bin", op: "+", l: num(1), r: num(2) }, r: num(3) });
  });

  test("unary binds tighter than binary, looser than member access", () => {
    expect(ast("!a.b")).toEqual({ t: "unary", op: "!", arg: { t: "member", obj: id("a"), name: "b" } });
    expect(ast("-3 + 5")).toEqual({ t: "bin", op: "+", l: { t: "unary", op: "-", arg: num(3) }, r: num(5) });
  });

  test("member, index and call chains", () => {
    expect(ast('file.hasTag("x")')).toEqual({
      t: "call",
      callee: { t: "member", obj: id("file"), name: "hasTag" },
      args: [{ t: "lit", v: "x" }],
    });
    expect(ast('note["a b"].length')).toEqual({
      t: "member",
      obj: { t: "index", obj: id("note"), key: { t: "lit", v: "a b" } },
      name: "length",
    });
    expect(ast("now()")).toEqual({ t: "call", callee: id("now"), args: [] });
    expect(ast("f(1, g(2))")).toMatchObject({ t: "call", args: [num(1), { t: "call" }] });
  });

  test("unicode identifiers", () => {
    expect(ast("zażółć")).toEqual(id("zażółć"));
  });
});

describe("parseExpression: refusals", () => {
  test("syntax outside the subset is an error value, never a throw", () => {
    for (const bad of ["1 +", "(1", "a b", "x => x", "a ? b : c", '"open', "file.", "{a: 1}", "f(1,)", "a = 1", "a & b", "", "[1]"]) {
      const r = parseExpression(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  test("depth and length are capped", () => {
    expect(parseExpression(`${"(".repeat(200)}1${")".repeat(200)}`).ok).toBe(false);
    expect(parseExpression(`${"!".repeat(200)}a`).ok).toBe(false);
    expect(parseExpression(`${"1+".repeat(2000)}1`).ok).toBe(false);
  });
});
