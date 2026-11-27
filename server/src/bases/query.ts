import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  type BaseQueryRequest,
  type BaseQueryResponse,
  type FilterNode,
} from "@brainmd/shared/base-types";
import { parseExpression, type Node } from "./expr";
import { DEFAULT_BUDGET, evaluate, type Scope } from "./eval";
import {
  FileObject,
  compareValues,
  toProp,
  toStr,
  truthy,
  type FileData,
  type FileHost,
  type Value,
} from "./functions";
import { parseBase, type ViewConfig } from "./parse";

export interface QueryEntry {
  path: string;
  title: string;
  size: number;
  mtime: number;
  ctime: number;
  tags: string[];
  props: Record<string, PropValue>;
  revision: string;
  outLinks: Array<{ target: string; embed: boolean }>;
}

// The slice of VaultIndex a query reads, so tests can pass a plain object.
export interface QueryIndex {
  entries(): QueryEntry[];
  backlinks(path: string, allowed?: (path: string) => boolean): Array<{ from: string }>;
  resolveLink(fromPath: string, target: string): string | undefined;
  visibility: { isHidden(path: string): boolean };
}

export interface QueryDeps {
  index: QueryIndex;
  allowed: (path: string) => boolean;
  // Effective property types (registry first, then inferred), from listProperties.
  types: ReadonlyMap<string, PropertyType>;
  now?: Date;
}

type Compiled = { leaf: Node | null } | { op: "and" | "or" | "not"; kids: Compiled[] };

const DEFAULT_VIEW: ViewConfig = {
  type: "table",
  name: "Table",
  order: [],
  sort: [],
  groupOrder: [],
  columnSize: {},
  summaries: {},
};

const WIKI = /^\[\[([^\]|#^]*)/;
const MAX_CELL = 10_000;
const MAX_RESPONSE_CHARS = 5_000_000;
const DROP = Symbol("drop");
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function runBaseQuery(req: BaseQueryRequest, deps: QueryDeps): BaseQueryResponse {
  const warned: string[] = [];
  try {
    return run(req, deps, warned);
  } catch (e) {
    console.error("bases query failed:", e);
    return { views: [], view: "", columns: [], groups: [], total: 0, warnings: [...warned, "the view could not be evaluated"] };
  }
}

function run(req: BaseQueryRequest, deps: QueryDeps, warned: string[]): BaseQueryResponse {
  const { index, allowed, types } = deps;
  const now = deps.now ?? new Date();
  const warnings = new Set<string>();
  const warn = (m: string): void => {
    if (!warnings.has(m)) warned.push(m);
    warnings.add(m);
  };
  const done = (r: Omit<BaseQueryResponse, "warnings">): BaseQueryResponse => ({ ...r, warnings: [...warnings] });
  const nothing = { views: [], view: "", columns: [], groups: [], total: 0 };

  const parsed = parseBase(req.source);
  for (const w of parsed.warnings) warn(w);
  if (parsed.fatal) return done(nothing);
  const cfg = parsed.config;
  const views = cfg.views.length > 0 ? cfg.views : [DEFAULT_VIEW];
  const wanted = req.view?.toLowerCase();
  const view = (req.view ? views.find((v) => v.name === req.view) : undefined) ?? views.find((v) => v.name.toLowerCase() === wanted) ?? views[0]!;
  if (req.view && view.name.toLowerCase() !== wanted) warn(`view "${req.view}" was not found; showing "${view.name}"`);

  const entries = index.entries();
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const host: FileHost = {
    resolveLink: (from, target) => index.resolveLink(from, target),
    outLinks: (path) =>
      (byPath.get(path)?.outLinks ?? [])
        .map((l) => ({ text: l.target, embed: l.embed, path: index.resolveLink(path, l.target) ?? null }))
        .filter((l) => l.path === null || allowed(l.path)),
    backlinks: (path) => [...new Set(index.backlinks(path, allowed).map((b) => b.from))],
  };
  const files = new Map<string, FileObject>();
  const fileOf = (e: QueryEntry): FileObject => {
    let f = files.get(e.path);
    if (!f) {
      const data: FileData = { path: e.path, size: e.size, ctime: e.ctime, mtime: e.mtime, tags: e.tags, props: e.props };
      f = new FileObject(data, host);
      files.set(e.path, f);
    }
    return f;
  };

  let thisPath = req.thisPath;
  if (thisPath && (!allowed(thisPath) || !byPath.has(thisPath))) {
    warn("the note holding this view is not readable; `this` was left empty");
    thisPath = undefined;
  }
  const thisEntry = thisPath ? byPath.get(thisPath) : undefined;
  let thisValue: Value = null;
  if (thisEntry) {
    const t: Record<string, Value> = Object.create(null);
    Object.assign(t, thisEntry.props);
    t.file = fileOf(thisEntry);
    thisValue = t;
  }

  const formulaNodes = new Map<string, Node | null>();
  const formulaNode = (name: string): Node | null => {
    if (formulaNodes.has(name)) return formulaNodes.get(name)!;
    const p = parseExpression(cfg.formulas[name]!);
    if (!p.ok) warn(`formula "${name}": ${p.error}`);
    const node = p.ok ? p.node : null;
    formulaNodes.set(name, node);
    return node;
  };

  // Formula results can be large; they are dropped once a row's sort and group keys are read.
  const memos = new Map<Scope, Map<string, Value>>();
  const release = (scope: Scope): void => {
    memos.get(scope)?.clear();
  };
  const scopeFor = (e: QueryEntry): Scope => {
    const memo = new Map<string, Value>();
    const busy = new Set<string>();
    const scope: Scope = {
      now,
      warn,
      file: fileOf(e),
      props: e.props,
      thisValue,
      // Per note, so a big vault cannot run one shared budget dry and drop the tail rows.
      budget: { steps: 0, max: DEFAULT_BUDGET, hit: false },
      formula: (name) => {
        if (!Object.hasOwn(cfg.formulas, name)) {
          warn(`unknown formula "${name}"`);
          return null;
        }
        if (memo.has(name)) return memo.get(name)!;
        if (busy.has(name)) {
          warn(`formula "${name}" refers to itself`);
          return null;
        }
        busy.add(name);
        const node = formulaNode(name);
        const v = node ? evaluate(node, scope) : null;
        busy.delete(name);
        memo.set(name, v);
        return v;
      },
    };
    memos.set(scope, memo);
    return scope;
  };

  const compile = (f: FilterNode | undefined): Compiled | null => {
    if (f === undefined) return null;
    if (typeof f === "string") {
      const p = parseExpression(f);
      if (!p.ok) warn(`filter ignored (${p.error}): ${f}`);
      return { leaf: p.ok ? p.node : null };
    }
    const op = "and" in f ? "and" : "or" in f ? "or" : "not";
    const list = (f as Record<string, FilterNode[]>)[op]!;
    return { op, kids: list.map((k) => compile(k)).filter((k): k is Compiled => k !== null) };
  };

  // undefined: the filter could not be read, so it neither passes nor fails a row.
  const test = (c: Compiled, scope: Scope): boolean | undefined => {
    if ("leaf" in c) return c.leaf ? truthy(evaluate(c.leaf, scope)) : undefined;
    const res = c.kids.map((k) => test(k, scope)).filter((r): r is boolean => r !== undefined);
    if (res.length === 0) return undefined;
    if (c.op === "and") return res.every(Boolean);
    if (c.op === "or") return res.some(Boolean);
    return !res.some(Boolean);
  };

  const globalFilter = compile(cfg.filters);
  const viewFilter = compile(view.filters);
  const rows: Array<{ e: QueryEntry; scope: Scope }> = [];
  for (const e of entries) {
    if (!allowed(e.path) || e.path === thisPath || index.visibility.isHidden(e.path)) continue;
    const scope = scopeFor(e);
    const out =
      (globalFilter && test(globalFilter, scope) === false) ||
      (viewFilter && test(viewFilter, scope) === false) ||
      // A budget hit makes every expression of the note null; a `not` must not turn that into a pass.
      scope.budget.hit;
    release(scope);
    if (out) continue;
    rows.push({ e, scope });
  }

  const keyValue = (key: string, scope: Scope): Value => {
    if (key.startsWith("file.")) return scope.file.get(key.slice(5));
    if (key.startsWith("formula.")) return scope.formula(key.slice(8));
    const name = key.startsWith("note.") ? key.slice(5) : key;
    return Object.hasOwn(scope.props, name) ? (scope.props[name] as Value) : null;
  };

  const isEmpty = (v: Value): boolean => v === null || v === "" || (Array.isArray(v) && v.length === 0);
  const order = (a: Value, b: Value): number => compareValues(a, b) ?? toStr(a).localeCompare(toStr(b), undefined, { numeric: true });

  const slim = (v: Value): Value => (typeof v === "string" && v.length > 1000 ? v.slice(0, 1000) : v);
  const sortVals = new Map(
    rows.map((r) => {
      const vals = view.sort.map((s) => slim(keyValue(s.property, r.scope)));
      release(r.scope);
      return [r, vals];
    }),
  );
  rows.sort((x, y) => {
    for (let i = 0; i < view.sort.length; i++) {
      const a = sortVals.get(x)![i]!;
      const b = sortVals.get(y)![i]!;
      const ea = isEmpty(a);
      const eb = isEmpty(b);
      if (ea || eb) {
        if (ea && eb) continue;
        return ea ? 1 : -1;
      }
      const c = order(a, b);
      if (c !== 0) return view.sort[i]!.direction === "DESC" ? -c : c;
    }
    return x.e.path.localeCompare(y.e.path);
  });

  const clean = (v: PropValue, from: string, depth = 0): PropValue | typeof DROP => {
    if (typeof v === "string") {
      const m = WIKI.exec(v);
      const target = m?.[1]?.trim();
      if (target) {
        const to = index.resolveLink(from, target);
        if (to && !allowed(to)) return DROP;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => clean(x, from, depth + 1)).filter((x): x is PropValue => x !== DROP);
    if (v && typeof v === "object" && depth < 4) {
      const out: Record<string, PropValue> = Object.create(null);
      for (const [k, x] of Object.entries(v)) {
        const c = clean(x, from, depth + 1);
        out[k] = c === DROP ? null : c;
      }
      return out;
    }
    return v;
  };

  const groupKeyOf = (v: Value, from: string): string | null => {
    if (isEmpty(v)) return null;
    const c = clean(toProp(v), from);
    if (c === DROP) return null;
    const text = Array.isArray(c) ? (c.length === 0 ? null : c.map(String).join(", ")) : String(c);
    return text === null ? null : text.slice(0, 1000);
  };

  const gb = view.groupBy;
  type Item = { e: QueryEntry; scope: Scope; group: string | null };
  const groupOf = new Map<Item, Value>();
  let items: Item[] = rows.map((r) => {
    const raw = gb ? slim(keyValue(gb.property, r.scope)) : null;
    const it = { ...r, group: gb ? groupKeyOf(raw, r.e.path) : null };
    groupOf.set(it, raw);
    release(r.scope);
    return it;
  });

  let groupKeys: Array<string | null> = [null];
  if (gb) {
    const present = new Map<string | null, Value>();
    for (const it of items) if (!present.has(it.group)) present.set(it.group, groupOf.get(it)!);
    const listed = view.groupOrder.filter((k, i, a) => a.indexOf(k) === i);
    const rest = [...present.keys()].filter((k): k is string => k !== null && !listed.includes(k));
    rest.sort((a, b) => order(present.get(a)!, present.get(b)!));
    if (gb.direction === "DESC") rest.reverse();
    groupKeys = [...listed, ...rest, null];
    const rank = new Map(groupKeys.map((k, i) => [k, i]));
    items = items.sort((a, b) => rank.get(a.group)! - rank.get(b.group)!);
  }
  if (view.limit !== undefined) items = items.slice(0, view.limit);

  const total = items.length;
  const wantLimit = Number.isFinite(req.limit) ? Math.floor(req.limit!) : DEFAULT_QUERY_LIMIT;
  const limit = Math.min(Math.max(1, wantLimit), MAX_QUERY_LIMIT);
  const offset = Number.isFinite(req.offset) ? Math.max(0, Math.floor(req.offset!)) : 0;
  const page = items.slice(offset, offset + limit);

  const colKeys = view.order.length > 0 ? view.order : ["file.name"];
  const display = new Map<string, string>();
  for (const [k, v] of Object.entries(cfg.properties)) if (v.displayName) display.set(k.replace(/^note\./, ""), v.displayName);
  const labelFor = (key: string): string => {
    const dn = display.get(key.replace(/^note\./, ""));
    if (dn) return dn;
    if (key.startsWith("file.")) return cap(key.slice(5));
    if (key.startsWith("formula.")) return key.slice(8);
    return key.replace(/^note\./, "");
  };
  const typeFor = (key: string): PropertyType | "file" | "formula" =>
    key.startsWith("file.") ? "file" : key.startsWith("formula.") ? "formula" : (types.get(key.replace(/^note\./, "")) ?? "text");

  // The cover property of a cards view rides along in `values` without being a column.
  const valueKeys = view.image && !colKeys.includes(view.image) ? [...colKeys, view.image] : colKeys;
  let spent = 0;
  const fit = (v: PropValue, depth = 0): PropValue => {
    if (typeof v === "string") {
      if (v.length > MAX_CELL) {
        warn(`a long value was cut to ${MAX_CELL} characters`);
        v = v.slice(0, MAX_CELL);
      }
      spent += v.length;
      return v;
    }
    spent += 8;
    if (Array.isArray(v)) return v.map((x) => fit(x, depth + 1));
    if (v && typeof v === "object" && depth < 4) {
      const out: Record<string, PropValue> = Object.create(null);
      for (const [k, x] of Object.entries(v)) out[k] = fit(x, depth + 1);
      return out;
    }
    return v;
  };
  const outRow = (it: Item) => {
    const values: Record<string, PropValue> = Object.create(null);
    for (const k of valueKeys) {
      if (spent > MAX_RESPONSE_CHARS) {
        warn("the response was too large; later cells were left empty");
        values[k] = null;
        continue;
      }
      const c = clean(toProp(keyValue(k, it.scope)), it.e.path);
      values[k] = c === DROP ? null : fit(c);
    }
    release(it.scope);
    return { path: it.e.path, title: it.e.title, revision: it.e.revision, values };
  };

  const groups: BaseQueryResponse["groups"] = [];
  if (!gb) {
    groups.push({ key: null, label: "", count: total, rows: page.map(outRow) });
  } else {
    const counts = new Map<string | null, number>();
    for (const i of items) counts.set(i.group, (counts.get(i.group) ?? 0) + 1);
    const byGroup = new Map<string | null, Item[]>();
    for (const i of page) {
      const list = byGroup.get(i.group);
      if (list) list.push(i);
      else byGroup.set(i.group, [i]);
    }
    for (const key of groupKeys) {
      const count = counts.get(key) ?? 0;
      const inPage = byGroup.get(key) ?? [];
      const declared = key !== null && offset === 0 && view.groupOrder.includes(key);
      if (inPage.length === 0 && !(declared && count === 0)) continue;
      groups.push({ key, label: key ?? "No value", count, rows: inPage.map(outRow) });
    }
  }

  return done({
    views: views.map((v) => ({ name: v.name, type: v.type })),
    view: view.name,
    columns: colKeys.map((key) => ({ key, label: labelFor(key), type: typeFor(key) })),
    groups,
    total,
  });
}
