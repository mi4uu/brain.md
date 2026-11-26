import { readFrontmatter, renameProperty, setProperties, type PropValue } from "@brainmd/shared/frontmatter";
import {
  DATETIME_RE,
  DATE_RE,
  inferType,
  resolveType,
  type PropertyInfo,
  type PropertyType,
} from "@brainmd/shared/property-types";

export interface PropRow {
  name: string;
  value: PropValue;
  type: PropertyType;
  nested: boolean;
}

export type PanelModel =
  | { kind: "rows"; rows: PropRow[]; offset: number }
  | { kind: "error"; message: string; offset: number };

export function isNested(v: PropValue): boolean {
  if (Array.isArray(v)) return v.some((x) => typeof x === "object" && x !== null);
  return typeof v === "object" && v !== null;
}

// `infos` is GET /api/properties: its type per name already folds in the
// registry, so it only needs to win over inference from this one value.
// `offset` is where "edit in source" and "Fix in source" put the cursor:
// the first line after the opening `---`.
export function buildModel(content: string, infos: PropertyInfo[]): PanelModel {
  const fm = readFrontmatter(content);
  const offset = fm.range ? fm.range.from + 4 : 0;
  if (fm.error !== null) return { kind: "error", message: fm.error, offset };
  const known = new Map(infos.map((i) => [i.name, i.type]));
  const rows = Object.entries(fm.props ?? {}).map(([name, value]) => ({
    name,
    value,
    nested: isNested(value),
    type: resolveType(name, known.get(name), inferType([value])),
  }));
  return { kind: "rows", rows, offset };
}

export const editSet = (name: string, value: PropValue) => (c: string) => setProperties(c, { [name]: value });
export const editUnset = (name: string) => (c: string) => setProperties(c, {}, [name]);
export const editRename = (from: string, to: string) => (c: string) => renameProperty(c, from, to);

export function initialValue(type: PropertyType): PropValue {
  if (type === "multitext" || type === "tags" || type === "aliases") return [];
  if (type === "checkbox") return false;
  return null;
}

export function toList(v: PropValue): string[] {
  if (v === null) return [];
  if (Array.isArray(v)) return v.filter((x) => x !== null && typeof x !== "object").map((x) => String(x));
  if (typeof v === "object") return [];
  const s = String(v);
  return s === "" ? [] : [s];
}

export function cleanItem(type: PropertyType, raw: string): string {
  const t = raw.trim();
  return type === "tags" ? t.replace(/^#+/, "").replace(/\s+/g, "-") : t;
}

export function listFor(type: PropertyType, items: string[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const c = cleanItem(type, it);
    if (c !== "" && !out.includes(c)) out.push(c);
  }
  return out;
}

export function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function textOf(v: PropValue): string {
  return v === null || typeof v === "object" ? "" : String(v);
}

// Native date inputs need exact formats; anything else falls back to text so
// an unusual stored value is never silently dropped.
export function nativeDate(v: PropValue): string | null {
  if (v === null) return "";
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}

export function nativeDateTime(v: PropValue): string | null {
  if (v === null) return "";
  return typeof v === "string" && DATETIME_RE.test(v) ? v.slice(0, 16) : null;
}

export function minimalChange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--;
    endAfter--;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
