import { parse as parseYaml } from "yaml";
import type { Direction, FilterNode, SortSpec } from "./base-types";

export interface ViewConfig {
  type: string;
  name: string;
  filters?: FilterNode;
  order: string[];
  sort: SortSpec[];
  groupBy?: { property: string; direction: Direction };
  groupOrder: string[];
  limit?: number;
  columnSize: Record<string, number>;
  summaries: Record<string, string>;
  image?: string;
}

export interface BaseConfig {
  filters?: FilterNode;
  formulas: Record<string, string>;
  properties: Record<string, { displayName?: string }>;
  summaries: Record<string, string>;
  views: ViewConfig[];
}

export interface ParsedBase {
  config: BaseConfig;
  warnings: string[];
  // YAML that does not parse at all: nothing to run.
  fatal: boolean;
}

export const MAX_SOURCE_CHARS = 100_000;
// Every column is a cell in every row, and sort and group lists are walked per note,
// so their length is bounded here rather than by the source size.
export const MAX_COLUMNS = 200;
export const MAX_SORTS = 20;
export const MAX_GROUP_NAMES = 1000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function capped<T>(items: Iterable<T>, keyOf: (x: T) => string, max: number, onCut: () => void): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of items) {
    const k = keyOf(x);
    if (seen.has(k)) continue;
    if (out.length === max) {
      onCut();
      break;
    }
    seen.add(k);
    out.push(x);
  }
  return out;
}

function direction(v: unknown): Direction {
  return typeof v === "string" && /^desc/i.test(v) ? "DESC" : "ASC";
}

export function parseFilter(v: unknown, warn: (m: string) => void, depth = 0): FilterNode | undefined {
  if (typeof v === "string") return v;
  if (depth > 12 || !isRecord(v)) {
    if (v !== undefined && v !== null) warn("a filter must be an expression or an and / or / not list");
    return undefined;
  }
  for (const op of ["and", "or", "not"] as const) {
    const list = own(v, op);
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      warn(`filter "${op}" must be a list`);
      return undefined;
    }
    const extra = ["and", "or", "not"].filter((k) => k !== op && own(v, k) !== undefined);
    if (extra.length > 0) warn(`filter uses "${op}"; ignored: ${extra.join(", ")}`);
    const kids = list.map((k) => parseFilter(k, warn, depth + 1)).filter((k): k is FilterNode => k !== undefined);
    return { [op]: kids } as FilterNode;
  }
  warn("a filter must be an expression or an and / or / not list");
  return undefined;
}

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
}

function parseView(v: unknown, i: number, warn: (m: string) => void): ViewConfig {
  const pre = `view ${i + 1}:`;
  if (!isRecord(v)) warn(`${pre} must be a mapping`);
  const o = isRecord(v) ? v : {};
  if (o.type !== undefined && (typeof o.type !== "string" || o.type === "")) warn(`${pre} "type" must be a non-empty string, using table`);
  const type = typeof o.type === "string" && o.type !== "" ? o.type : "table";
  for (const k of ["order", "groupOrder", "sort"] as const) {
    if (o[k] !== undefined && !Array.isArray(o[k])) warn(`${pre} "${k}" must be a list`);
  }
  if (o.groupBy !== undefined && !(isRecord(o.groupBy) && typeof o.groupBy.property === "string")) warn(`${pre} "groupBy" needs a property`);
  if (o.limit !== undefined && !(typeof o.limit === "number" && Number.isFinite(o.limit) && o.limit > 0)) warn(`${pre} "limit" must be a positive number`);
  const sorts: SortSpec[] = [];
  for (const s of Array.isArray(o.sort) ? o.sort : []) {
    if (isRecord(s) && typeof s.property === "string") sorts.push({ property: s.property, direction: direction(s.direction) });
    else warn(`${pre} a "sort" entry needs a property`);
  }
  const order = capped(strings(o.order), (x) => x, MAX_COLUMNS, () => warn(`${pre} "order" lists more than ${MAX_COLUMNS} columns; the rest were ignored`));
  const sort = capped(sorts, (x) => x.property, MAX_SORTS, () => warn(`${pre} "sort" has more than ${MAX_SORTS} entries; the rest were ignored`));
  const groupOrder = capped(strings(o.groupOrder), (x) => x, MAX_GROUP_NAMES, () =>
    warn(`${pre} "groupOrder" lists more than ${MAX_GROUP_NAMES} groups; the rest were ignored`),
  );
  const gb = isRecord(o.groupBy) && typeof o.groupBy.property === "string" ? o.groupBy : null;
  const sizes: Record<string, number> = Object.create(null);
  if (isRecord(o.columnSize)) {
    for (const [k, x] of Object.entries(o.columnSize)) {
      if (typeof x === "number" && x > 0) sizes[/^(note|file|formula)\./.test(k) ? k : `note.${k}`] = x;
    }
  }
  const limit = typeof o.limit === "number" && Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : undefined;
  return {
    type,
    name: typeof o.name === "string" && o.name !== "" ? o.name : `${type[0]!.toUpperCase()}${type.slice(1)}${i > 0 ? ` ${i + 1}` : ""}`,
    filters: parseFilter(o.filters, (m) => warn(`view ${i + 1}: ${m}`)),
    order,
    sort,
    groupBy: gb ? { property: gb.property as string, direction: direction(gb.direction) } : undefined,
    groupOrder,
    limit,
    columnSize: sizes,
    summaries: stringMap(o.summaries),
    image: typeof o.image === "string" ? o.image : undefined,
  };
}

export function parseBase(source: string): ParsedBase {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const empty = (): BaseConfig => ({ formulas: Object.create(null), properties: Object.create(null), summaries: Object.create(null), views: [] });
  if (source.length > MAX_SOURCE_CHARS) return { config: empty(), warnings: ["the view definition is too large"], fatal: true };
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    return { config: empty(), warnings: [`YAML: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`], fatal: true };
  }
  if (raw === null || raw === undefined) return { config: empty(), warnings, fatal: false };
  if (!isRecord(raw)) return { config: empty(), warnings: ["the view definition must be a YAML mapping"], fatal: true };

  const formulas: Record<string, string> = Object.create(null);
  const f = own(raw, "formulas");
  if (isRecord(f)) for (const [k, v] of Object.entries(f)) if (typeof v === "string") formulas[k] = v;

  const properties: BaseConfig["properties"] = Object.create(null);
  const p = own(raw, "properties");
  if (isRecord(p)) {
    for (const [k, v] of Object.entries(p)) {
      if (isRecord(v) && typeof v.displayName === "string") properties[k] = { displayName: v.displayName };
    }
  }

  const viewsRaw = own(raw, "views");
  const views = Array.isArray(viewsRaw) ? viewsRaw.map((v, i) => parseView(v, i, warn)) : [];
  if (viewsRaw !== undefined && viewsRaw !== null && !Array.isArray(viewsRaw)) warn('"views" must be a list');

  return {
    config: {
      filters: parseFilter(own(raw, "filters"), warn),
      formulas,
      properties,
      summaries: stringMap(own(raw, "summaries")),
      views,
    },
    warnings,
    fatal: false,
  };
}
