import type { SortSpec } from "@brainmd/shared/base-types";
import { columnId } from "@brainmd/shared/base-yaml";
import { effectiveOrder } from "./model";

export interface KeyOption {
  key: string;
  label: string;
  // Registry type when known (PropertyType, "file" or "formula"); steers how filter values are quoted.
  type?: string;
}

// View names are the lookup key, so a rename must not collide with another view.
export const isNameTaken = (names: string[], name: string, exceptIndex = -1): boolean =>
  names.some((n, i) => i !== exceptIndex && n === name);

// A refused splice reports false; undefined and true both mean it was applied.
export const wasApplied = (r: boolean | void): boolean => r !== false;

export const VIEW_TYPES = ["table", "cards", "list", "kanban"] as const;

export const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function freshName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

export const sameKey = (a: string, b: string): boolean => columnId(a) === columnId(b);
const hasKey = (keys: readonly string[], key: string): boolean => keys.some((k) => sameKey(k, key));

export function labelOf(options: KeyOption[], key: string): string {
  return options.find((o) => sameKey(o.key, key))?.label ?? key;
}

// The option a stored key stands for, so a bare `status` selects the `note.status` entry.
export function optionKeyFor(options: KeyOption[], key: string): string {
  return options.find((o) => sameKey(o.key, key))?.key ?? key;
}

export function nextView(views: { name: string }[], index: number): string | undefined {
  return views.find((_, i) => i !== index)?.name;
}

export function addSort(sorts: SortSpec[], options: KeyOption[]): SortSpec[] | null {
  const unused = options.find((o) => !sorts.some((s) => sameKey(s.property, o.key)));
  return unused ? [...sorts, { property: unused.key, direction: "ASC" }] : null;
}

export function sortChoices(sorts: SortSpec[], options: KeyOption[], index: number): KeyOption[] {
  return options.filter((o) => !sorts.some((s, j) => j !== index && sameKey(s.property, o.key)));
}

export function setSortProperty(sorts: SortSpec[], index: number, property: string): SortSpec[] | null {
  if (sorts.some((s, j) => j !== index && sameKey(s.property, property))) return null;
  return sorts.map((s, j) => (j === index ? { ...s, property } : s));
}

export const flipSort = (sorts: SortSpec[], index: number): SortSpec[] =>
  sorts.map((s, j) => (j === index ? { ...s, direction: s.direction === "ASC" ? "DESC" : "ASC" } : s));

export const removeSort = (sorts: SortSpec[], index: number): SortSpec[] => sorts.filter((_, j) => j !== index);

export function hideColumn(order: string[], key: string): string[] | null {
  const cur = effectiveOrder(order);
  if (cur.length <= 1) return null;
  return cur.filter((k) => !sameKey(k, key));
}

export function showColumn(order: string[], key: string): string[] {
  const cur = effectiveOrder(order);
  return hasKey(cur, key) ? cur : [...cur, key];
}

export function shiftColumn(order: string[], key: string, delta: -1 | 1): string[] | null {
  const cur = [...effectiveOrder(order)];
  const i = cur.findIndex((k) => sameKey(k, key));
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return null;
  [cur[i], cur[j]] = [cur[j]!, cur[i]!];
  return cur;
}

export function hiddenOptions(order: string[], options: KeyOption[]): KeyOption[] {
  const cur = effectiveOrder(order);
  return options.filter((o) => !hasKey(cur, o.key));
}

// Bases string literals understand \\, \", \n and \t; any other control character would end up raw.
export function quoteString(s: string): string {
  let out = '"';
  for (const ch of s.replace(/\r\n?/g, "\n")) {
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "\n") out += "\\n";
    else if (ch === "\t") out += "\\t";
    else if (ch.charCodeAt(0) < 32) out += " ";
    else out += ch;
  }
  return out + '"';
}

const IDENT = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;

export function propertyRef(key: string): string | null {
  const id = columnId(key);
  const dot = id.indexOf(".");
  const ns = id.slice(0, dot);
  const name = id.slice(dot + 1);
  if (!name) return null;
  if (IDENT.test(name)) return id;
  return ns === "file" ? null : `${ns}[${quoteString(name)}]`;
}

export const FILTER_OPS = [
  { id: "is", label: "is", needsValue: true },
  { id: "isNot", label: "is not", needsValue: true },
  { id: "contains", label: "contains", needsValue: true },
  { id: "gt", label: "is greater than", needsValue: true },
  { id: "lt", label: "is less than", needsValue: true },
  { id: "empty", label: "is empty", needsValue: false },
  { id: "notEmpty", label: "is not empty", needsValue: false },
] as const;
export type FilterOp = (typeof FILTER_OPS)[number]["id"];

const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)$/;
const digitCount = (v: string): number => v.replace(/\D/g, "").length;
const TEXTY = new Set(["text", "multitext", "date", "datetime", "tags", "aliases", "file"]);

// A number literal only when it survives the round trip: no leading zeros, at most 15 digits.
function plainNumber(v: string): boolean {
  const t = v.trim();
  return NUMBER.test(t) && digitCount(t) <= 15 && !/^-?0\d/.test(t);
}

// null: the value cannot be written for that type without changing its meaning.
export function literal(v: string, type?: string): string | null {
  const t = v.trim();
  if (type !== undefined && TEXTY.has(type)) return quoteString(v);
  if (type === "number") return NUMBER.test(t) && digitCount(t) <= 15 ? String(Number(t)) : null;
  if (type === "checkbox") return t === "true" || t === "false" ? t : null;
  if (t === "true" || t === "false") return t;
  return plainNumber(t) ? String(Number(t)) : quoteString(v);
}

// The value is data: it only ever becomes a quoted literal or a plain number.
export function buildFilter(key: string, op: FilterOp, value: string, type?: string): string | null {
  const ref = propertyRef(key);
  if (ref === null) return null;
  const meta = FILTER_OPS.find((o) => o.id === op);
  if (!meta) return null;
  if (meta.needsValue && value.trim() === "") return null;
  const lit = meta.needsValue ? literal(value, type) : "";
  if (lit === null) return null;
  switch (op) {
    case "is":
      return `${ref} == ${lit}`;
    case "isNot":
      return `${ref} != ${lit}`;
    case "contains":
      return `${ref}.contains(${quoteString(value)})`;
    case "gt":
      return `${ref} > ${lit}`;
    case "lt":
      return `${ref} < ${lit}`;
    case "empty":
      return `${ref}.isEmpty()`;
    case "notEmpty":
      return `!${ref}.isEmpty()`;
  }
}

// Commit a rewritten filter row; null when nothing would change.
export function replaceFilter(list: string[], index: number, text: string): string[] | null {
  const next = text.trim();
  if (next === list[index]) return null;
  return list.map((x, j) => (j === index ? next : x));
}
