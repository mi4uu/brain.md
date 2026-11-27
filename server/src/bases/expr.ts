export type Node =
  | { t: "lit"; v: null | boolean | number | string }
  | { t: "id"; name: string }
  | { t: "member"; obj: Node; name: string }
  | { t: "index"; obj: Node; key: Node }
  | { t: "call"; callee: Node; args: Node[] }
  | { t: "unary"; op: "!" | "-"; arg: Node }
  | { t: "bin"; op: string; l: Node; r: Node };

export class ExprError extends Error {}

interface Tok {
  k: "num" | "str" | "id" | "op" | "eof";
  v: string | number;
  pos: number;
}

const MAX_SOURCE = 2000;
const MAX_DEPTH = 64;
const OPS = ["&&", "||", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")", "[", "]", ".", ","];
const ID_RE = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const NUM_RE = /(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/y;

function tokenize(src: string): Tok[] {
  if (src.length > MAX_SOURCE) throw new ExprError("expression is too long");
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      let j = i + 1;
      for (;;) {
        if (j >= src.length) throw new ExprError("unterminated string");
        const d = src[j]!;
        if (d === c) break;
        if (d === "\\") {
          const e = src[j + 1];
          s += e === "n" ? "\n" : e === "t" ? "\t" : (e ?? "");
          j += 2;
          continue;
        }
        s += d;
        j++;
      }
      out.push({ k: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    NUM_RE.lastIndex = i;
    const num = NUM_RE.exec(src);
    if (num) {
      out.push({ k: "num", v: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    ID_RE.lastIndex = i;
    const id = ID_RE.exec(src);
    if (id) {
      out.push({ k: "id", v: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unsupported syntax "${String.fromCodePoint(src.codePointAt(i)!)}" at ${i}`);
    out.push({ k: "op", v: op, pos: i });
    i += op.length;
  }
  out.push({ k: "eof", v: "", pos: src.length });
  return out;
}

const INFIX: Record<string, [number, number]> = {
  "||": [1, 2],
  "&&": [3, 4],
  "==": [5, 6],
  "!=": [5, 6],
  "<": [7, 8],
  "<=": [7, 8],
  ">": [7, 8],
  ">=": [7, 8],
  "+": [9, 10],
  "-": [9, 10],
  "*": [11, 12],
  "/": [11, 12],
  "%": [11, 12],
};
const PREFIX_BP = 13;

class Parser {
  private p = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.p]!;
  }
  private next(): Tok {
    return this.toks[this.p++]!;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === "op" && t.v === v;
  }
  private expectOp(v: string): void {
    const t = this.next();
    if (t.k !== "op" || t.v !== v) throw new ExprError(`expected "${v}" at ${t.pos}`);
  }

  parseAll(): Node {
    const n = this.expr(0, 0);
    const t = this.peek();
    if (t.k !== "eof") throw new ExprError(`unexpected "${String(t.v)}" at ${t.pos}`);
    return n;
  }

  private expr(minBp: number, depth: number): Node {
    if (depth > MAX_DEPTH) throw new ExprError("expression is nested too deeply");
    let lhs = this.prefix(depth);
    for (;;) {
      const t = this.peek();
      if (t.k !== "op") break;
      const op = t.v as string;
      if (op === ".") {
        this.next();
        const name = this.next();
        if (name.k !== "id") throw new ExprError(`expected a name after "." at ${name.pos}`);
        lhs = { t: "member", obj: lhs, name: name.v as string };
        continue;
      }
      if (op === "(") {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.expr(0, depth + 1));
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expectOp(")");
        lhs = { t: "call", callee: lhs, args };
        continue;
      }
      if (op === "[") {
        this.next();
        const key = this.expr(0, depth + 1);
        this.expectOp("]");
        lhs = { t: "index", obj: lhs, key };
        continue;
      }
      const bp = INFIX[op];
      if (!bp || bp[0] < minBp) break;
      this.next();
      const rhs = this.expr(bp[1], depth + 1);
      lhs = { t: "bin", op, l: lhs, r: rhs };
    }
    return lhs;
  }

  private prefix(depth: number): Node {
    const t = this.next();
    if (t.k === "num") return { t: "lit", v: t.v as number };
    if (t.k === "str") return { t: "lit", v: t.v as string };
    if (t.k === "id") {
      if (t.v === "true") return { t: "lit", v: true };
      if (t.v === "false") return { t: "lit", v: false };
      if (t.v === "null") return { t: "lit", v: null };
      return { t: "id", name: t.v as string };
    }
    if (t.k === "op" && (t.v === "!" || t.v === "-")) {
      return { t: "unary", op: t.v, arg: this.expr(PREFIX_BP, depth + 1) };
    }
    if (t.k === "op" && t.v === "(") {
      const n = this.expr(0, depth + 1);
      this.expectOp(")");
      return n;
    }
    throw new ExprError(t.k === "eof" ? "unexpected end of expression" : `unexpected "${String(t.v)}" at ${t.pos}`);
  }
}

export function parseExpression(src: string): { ok: true; node: Node } | { ok: false; error: string } {
  if (typeof src !== "string") return { ok: false, error: "expression must be a string" };
  try {
    return { ok: true, node: new Parser(tokenize(src)).parseAll() };
  } catch (e) {
    return { ok: false, error: e instanceof ExprError ? e.message : "invalid expression" };
  }
}
