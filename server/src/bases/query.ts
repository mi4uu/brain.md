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
import { DEFAULT_BUDGET, MAX_STRING_WORK, evaluate, type Scope } from "./eval";
import {
  FileObject,
  LinkValue,
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
  // Cost units (about one per character) held between phases: formula values kept so they are not
  // computed again, and sort and group keys. Each has its own cap.
  retainCap?: { values?: number; keys?: number };
  stats?: { valuesPeak: number; keysPeak: number };
  stringWorkCap?: number;
  deadlineMs?: number;
}

type Row = { e: QueryEntry; scope: Scope; memo: Map<string, Value>; held: number };

type Compiled = { leaf: Node | null } | { op: "and" | "or" | "not"; kids: Compiled[] };

const DEFAULT_DEADLINE_MS = 2000;

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
const MAX_KEPT_STRING = 1_000;
const MAX_KEPT_VALUES = 16_000_000;
const MAX_KEPT_KEYS = 16_000_000;
const ENTRY_COST = 32;
const SMALL = ENTRY_COST + MAX_KEPT_STRING;
const DROP = Symbol("drop");
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
// JSC keeps a slice's whole parent alive; resolving a fresh rope copies just the kept characters.
const own = (s: string): string => (s.length < 2 ? s : (s + "\0").slice(0, -1));
const ownCut = (s: string): string => own(s.length > MAX_KEPT_STRING ? s.slice(0, MAX_KEPT_STRING) : s);
const clip = (v: Value): Value => {
  if (typeof v === "string") return ownCut(v);
  if (v instanceof LinkValue) return new LinkValue(ownCut(v.path), v.display === undefined ? undefined : ownCut(v.display));
  return v;
};

function weigh(v: Value, depth = 0): number {
  if (typeof v === "string") return ENTRY_COST + v.length;
  if (v instanceof LinkValue) return ENTRY_COST + v.path.length + (v.display?.length ?? 0);
  if (Array.isArray(v)) {
    let n = ENTRY_COST + 8 * v.length;
    if (depth < 4) for (const x of v) n += weigh(x, depth + 1);
    return n;
  }
  return ENTRY_COST;
}

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

  const parsedFormulas = new Map<string, ReturnType<typeof parseExpression>>();
  const parseFormula = (name: string): ReturnType<typeof parseExpression> => {
    let p = parsedFormulas.get(name);
    if (!p) {
      p = parseExpression(cfg.formulas[name]!);
      parsedFormulas.set(name, p);
    }
    return p;
  };
  const formulaNodes = new Map<string, Node | null>();
  const formulaNode = (name: string): Node | null => {
    if (formulaNodes.has(name)) return formulaNodes.get(name)!;
    const p = parseFormula(name);
    if (!p.ok) warn(`formula "${name}": ${p.error}`);
    const node = p.ok ? p.node : null;
    formulaNodes.set(name, node);
    return node;
  };

  const gb = view.groupBy;
  const colKeys = view.order.length > 0 ? view.order : ["file.name"];
  // The cover property of a cards view rides along in `values` without being a column.
  const valueKeys = view.image && !colKeys.includes(view.image) ? [...colKeys, view.image] : colKeys;

  // Formulas a later phase reads: sort, group and cell keys plus everything they refer to.
  // A reference that cannot be read statically (formula[expr]) keeps every formula.
  const later = new Set<string>();
  let laterAll = false;
  const todo: string[] = [];
  const want = (name: string): void => {
    if (Object.hasOwn(cfg.formulas, name) && !later.has(name)) {
      later.add(name);
      todo.push(name);
    }
  };
  for (const k of [...view.sort.map((x) => x.property), ...(gb ? [gb.property] : []), ...valueKeys]) {
    if (k.startsWith("formula.")) want(k.slice(8));
  }
  while (todo.length > 0 && !laterAll) {
    const p = parseFormula(todo.pop()!);
    const stack: Node[] = p.ok ? [p.node] : [];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.t === "member" && n.obj.t === "id" && n.obj.name === "formula") want(n.name);
      else if (n.t === "index" && n.obj.t === "id" && n.obj.name === "formula") {
        if (n.key.t === "lit" && typeof n.key.v === "string") want(n.key.v);
        else laterAll = true;
      } else if (n.t === "id" && n.name === "formula") laterAll = true;
      else if (n.t === "member") stack.push(n.obj);
      else if (n.t === "index") stack.push(n.obj, n.key);
      else if (n.t === "call") stack.push(n.callee, ...n.args);
      else if (n.t === "unary") stack.push(n.arg);
      else if (n.t === "bin") stack.push(n.l, n.r);
    }
  }

  // A formula is evaluated and charged once per note per query. Between phases a row keeps only
  // the values a later phase reads, only up to MAX_KEPT_STRING each, and only while the whole
  // query stays under the cap; anything else is computed (and charged) again if it is read.
  const valuesCap = deps.retainCap?.values ?? MAX_KEPT_VALUES;
  const keysCap = deps.retainCap?.keys ?? MAX_KEPT_KEYS;
  let values = 0;
  let keys = 0;
  const busy = new Set<string>();
  const work = {
    chars: 0,
    max: deps.stringWorkCap ?? MAX_STRING_WORK,
    ticks: 0,
    deadline: performance.now() + (deps.deadlineMs ?? DEFAULT_DEADLINE_MS),
    expired: false,
  };
  const release = (r: Row): void => {
    values -= r.held;
    r.held = 0;
    r.memo = new Map();
  };
  const park = (r: Row): void => {
    values -= r.held;
    r.held = 0;
    const kept = new Map<string, Value>();
    let cost = 0;
    for (const [k, v] of r.memo) {
      if (!laterAll && !later.has(k)) continue;
      const w = weigh(v);
      if (w > SMALL) continue;
      kept.set(k, v);
      cost += w;
    }
    if (values + cost > valuesCap) {
      if (kept.size > 0) warn("formula values were too large to keep for every note; some were computed again");
      r.memo = new Map();
      return;
    }
    r.memo = kept;
    r.held = cost;
    values += cost;
    if (deps.stats && values > deps.stats.valuesPeak) deps.stats.valuesPeak = values;
  };
  // Sort and group keys live to the end of the query, so they are counted and never released.
  // undefined: the key did not fit.
  const keepKey = (v: Value): Value | undefined => {
    const k = clip(v);
    const cost = weigh(k);
    if (keys + cost > keysCap) {
      warn("sort and group values were too large to keep for every note; some were left empty");
      return undefined;
    }
    keys += cost;
    if (deps.stats && keys > deps.stats.keysPeak) deps.stats.keysPeak = keys;
    return k;
  };
  const rowFor = (e: QueryEntry): Row => {
    const row: Row = { e, scope: undefined!, memo: new Map(), held: 0 };
    const scope: Scope = {
      now,
      warn,
      file: fileOf(e),
      props: e.props,
      thisValue,
      // Per note, so a big vault cannot run one shared budget dry and drop the tail rows.
      budget: { steps: 0, max: DEFAULT_BUDGET, hit: false, work },
      formula: (name) => {
        if (!Object.hasOwn(cfg.formulas, name)) {
          warn(`unknown formula "${name}"`);
          return null;
        }
        if (row.memo.has(name)) return row.memo.get(name)!;
        if (busy.has(name)) {
          warn(`formula "${name}" refers to itself`);
          return null;
        }
        busy.add(name);
        const node = formulaNode(name);
        const v = node ? evaluate(node, scope) : null;
        busy.delete(name);
        row.memo.set(name, weigh(v) <= SMALL ? clip(v) : v);
        return v;
      },
    };
    row.scope = scope;
    return row;
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
  const rows: Row[] = [];
  for (const e of entries) {
    if (!allowed(e.path) || e.path === thisPath || index.visibility.isHidden(e.path)) continue;
    const row = rowFor(e);
    const scope = row.scope;
    const out =
      (globalFilter && test(globalFilter, scope) === false) ||
      (viewFilter && test(viewFilter, scope) === false) ||
      // A budget hit makes every expression of the note null; a `not` must not turn that into a pass.
      scope.budget.hit;
    if (out) continue;
    park(row);
    rows.push(row);
  }

  const keyValue = (key: string, scope: Scope): Value => {
    if (key.startsWith("file.")) return scope.file.get(key.slice(5));
    if (key.startsWith("formula.")) return scope.formula(key.slice(8));
    const name = key.startsWith("note.") ? key.slice(5) : key;
    return Object.hasOwn(scope.props, name) ? (scope.props[name] as Value) : null;
  };

  const isEmpty = (v: Value): boolean => v === null || v === "" || (Array.isArray(v) && v.length === 0);
  const order = (a: Value, b: Value): number => compareValues(a, b) ?? toStr(a).localeCompare(toStr(b), undefined, { numeric: true });

  const sortVals = new Map(
    rows.map((r) => {
      const vals: Value[] = [];
      for (const s of view.sort) {
        const k = keepKey(keyValue(s.property, r.scope));
        if (k === undefined) break;
        vals.push(k);
      }
      if (view.sort.length > 0) park(r);
      return [r, vals];
    }),
  );
  rows.sort((x, y) => {
    for (let i = 0; i < view.sort.length; i++) {
      const a = sortVals.get(x)![i] ?? null;
      const b = sortVals.get(y)![i] ?? null;
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
    return text === null ? null : text.slice(0, MAX_KEPT_STRING);
  };

  type Item = { row: Row; e: QueryEntry; scope: Scope; group: string | null };
  // The raw value of each group's first row orders the groups.
  const present = new Map<string | null, Value>();
  let items: Item[] = rows.map((r) => {
    let group: string | null = null;
    if (gb) {
      const raw = keyValue(gb.property, r.scope);
      const key = groupKeyOf(raw, r.e.path);
      group = key === null ? null : ((keepKey(key) as string | undefined) ?? null);
      if (!present.has(group)) present.set(group, keepKey(raw) ?? null);
      park(r);
    }
    return { row: r, e: r.e, scope: r.scope, group };
  });

  let groupKeys: Array<string | null> = [null];
  if (gb) {
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
  const pageSet = new Set(page);
  for (const it of items) if (!pageSet.has(it)) release(it.row);

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

  let spent = 0;
  const fit = (v: PropValue, depth = 0): PropValue => {
    if (typeof v === "string") {
      if (v.length > MAX_CELL) {
        warn(`a long value was cut to ${MAX_CELL} characters`);
        v = own(v.slice(0, MAX_CELL));
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
    release(it.row);
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
