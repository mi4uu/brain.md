import type { PropValue } from "@brainmd/shared/frontmatter";
import type { Node } from "./expr";
import {
  DateValue,
  FileObject,
  FormulaRoot,
  UNSUPPORTED,
  addDuration,
  coerceDate,
  callGlobal,
  callMethod,
  compareValues,
  kindOf,
  looseEq,
  toStr,
  truthy,
  type FnCtx,
  type Value,
} from "./functions";

export interface Budget {
  steps: number;
  max: number;
  hit: boolean;
}

export interface Scope extends FnCtx {
  file: FileObject;
  props: Record<string, PropValue>;
  // `this.x` reads the note holding the view: its properties plus `file`.
  thisValue: Value;
  formula(name: string): Value;
  budget: Budget;
}

class BudgetExceeded extends Error {}

export const DEFAULT_BUDGET = 10_000;

const isPlainObject = (v: Value): v is { [k: string]: Value } => kindOf(v) === "object";

function getMember(obj: Value, name: string, s: Scope): Value {
  if (obj instanceof FileObject) return obj.get(name);
  if (obj instanceof FormulaRoot) return s.formula(name);
  if (isPlainObject(obj)) return Object.hasOwn(obj, name) ? (obj[name] ?? null) : null;
  if (name === "length" && (typeof obj === "string" || Array.isArray(obj))) return obj.length;
  return null;
}

const fin = (n: number): number | null => (Number.isFinite(n) ? n : null);

function arith(op: string, a: Value, b: Value, s: Scope): Value {
  const da = a instanceof DateValue ? a : typeof a === "string" && (op === "+" || op === "-") ? coerceDate(a) : null;
  if (da && (op === "+" || op === "-") && typeof b === "string") {
    const r = addDuration(da, b, op === "+" ? 1 : -1);
    if (r) return r;
    if (a instanceof DateValue) {
      s.warn(`invalid duration "${b}"`);
      return null;
    }
  }
  if (da && op === "-" && (a instanceof DateValue ? coerceDate(b) : b instanceof DateValue ? b : null)) {
    const other = coerceDate(b)!;
    return fin(da.ms - other.ms);
  }
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case "+":
        return fin(a + b);
      case "-":
        return fin(a - b);
      case "*":
        return fin(a * b);
      case "/":
        return b === 0 ? null : fin(a / b);
      case "%":
        return b === 0 ? null : fin(a % b);
    }
  }
  if (op === "+" && (typeof a === "string" || typeof b === "string") && a !== null && b !== null) {
    return `${toStr(a)}${toStr(b)}`;
  }
  return null;
}

function ev(n: Node, s: Scope): Value {
  if (s.budget.hit) return null;
  if (++s.budget.steps > s.budget.max) {
    s.budget.hit = true;
    throw new BudgetExceeded();
  }
  switch (n.t) {
    case "lit":
      return typeof n.v === "number" ? fin(n.v) : n.v;
    case "id":
      switch (n.name) {
        case "file":
          return s.file;
        case "note":
          return s.props as Value;
        case "formula":
          return new FormulaRoot();
        case "this":
          return s.thisValue;
        default:
          return Object.hasOwn(s.props, n.name) ? (s.props[n.name] as Value) : null;
      }
    case "member":
      return getMember(ev(n.obj, s), n.name, s);
    case "index": {
      const obj = ev(n.obj, s);
      const key = ev(n.key, s);
      if (typeof key === "string") return getMember(obj, key, s);
      if (typeof key === "number" && Array.isArray(obj)) return obj[key] ?? null;
      return null;
    }
    case "unary": {
      const v = ev(n.arg, s);
      return n.op === "!" ? !truthy(v) : typeof v === "number" ? fin(-v) : null;
    }
    case "bin": {
      if (n.op === "&&") return truthy(ev(n.l, s)) && truthy(ev(n.r, s));
      if (n.op === "||") return truthy(ev(n.l, s)) || truthy(ev(n.r, s));
      const a = ev(n.l, s);
      const b = ev(n.r, s);
      switch (n.op) {
        case "==":
          return looseEq(a, b);
        case "!=":
          return !looseEq(a, b);
        case "<":
        case "<=":
        case ">":
        case ">=": {
          const c = compareValues(a, b);
          if (c === null) return false;
          return n.op === "<" ? c < 0 : n.op === "<=" ? c <= 0 : n.op === ">" ? c > 0 : c >= 0;
        }
        default:
          return arith(n.op, a, b, s);
      }
    }
    case "call": {
      const callee = n.callee;
      if (callee.t === "id") {
        if (callee.name === "if") {
          if (n.args.length < 2) {
            s.warn('"if" needs a condition and a value');
            return null;
          }
          if (truthy(ev(n.args[0]!, s))) return ev(n.args[1]!, s);
          return n.args[2] ? ev(n.args[2], s) : null;
        }
        const r = callGlobal(callee.name, n.args.map((a) => ev(a, s)), s);
        if (r === UNSUPPORTED) {
          s.warn(`unsupported function "${callee.name}"`);
          return null;
        }
        return r;
      }
      if (callee.t === "member") {
        const recv = ev(callee.obj, s);
        const r = callMethod(recv, callee.name, n.args.map((a) => ev(a, s)), s);
        if (r === UNSUPPORTED) {
          s.warn(`unsupported function "${callee.name}"`);
          return null;
        }
        return r;
      }
      s.warn("unsupported call");
      return null;
    }
    default:
      return null;
  }
}

export function evaluate(n: Node, s: Scope): Value {
  try {
    const v = ev(n, s);
    return s.budget.hit ? null : v;
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      s.warn("evaluation budget exceeded for a note; its remaining expressions were skipped");
      return null;
    }
    s.warn("expression could not be evaluated");
    return null;
  }
}
