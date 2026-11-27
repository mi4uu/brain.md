import type { BaseQueryResponse, Direction, FilterNode, SortSpec } from "@brainmd/shared/base-types";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { cleanItem, fitsType, isNested } from "../properties/model";

export type ColumnType = PropertyType | "file" | "formula";

export const DEFAULT_COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 800;

export const clampWidth = (n: number): number => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(n)));

export function effectiveOrder(order: string[]): string[] {
  return order.length > 0 ? order : ["file.name"];
}

// The frontmatter key a column edits, or null for file.* and formula.* columns.
export function propNameOf(key: string): string | null {
  if (key.startsWith("file.") || key.startsWith("formula.")) return null;
  const name = key.startsWith("note.") ? key.slice(5) : key;
  return name === "" ? null : name;
}

export function isEditable(type: ColumnType, key: string, value: PropValue): boolean {
  if (type === "file" || type === "formula" || propNameOf(key) === null || isNested(value)) return false;
  if (type === "number" && value !== null && !(typeof value === "number" && Number.isFinite(value))) return false;
  return fitsType(type, value);
}

export type Coerced = { kind: "set"; value: PropValue } | { kind: "unset" } | { kind: "error"; message: string };

const LIST_TYPES: PropertyType[] = ["multitext", "tags", "aliases"];

export function coerceInput(type: PropertyType, raw: string): Coerced {
  const text = raw.trim();
  if (LIST_TYPES.includes(type)) {
    const items = text.split(",").map((s) => cleanItem(type, s)).filter(Boolean);
    return items.length === 0 ? { kind: "unset" } : { kind: "set", value: items };
  }
  if (text === "") return { kind: "unset" };
  if (type === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? { kind: "set", value: n } : { kind: "error", message: "Not a number" };
  }
  if (type === "checkbox") return { kind: "set", value: /^(true|yes|1|on)$/i.test(text) };
  return { kind: "set", value: text };
}

export function editText(value: PropValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => editText(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export const WIKI_CELL = /^\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]$/;

export function linkParts(v: string): { target: string; label: string } | null {
  const m = WIKI_CELL.exec(v.trim());
  if (!m || !m[1]!.trim()) return null;
  const target = m[1]!.trim();
  return { target, label: (m[2] ?? target.slice(target.lastIndexOf("/") + 1)).trim() };
}

export const SUMMARY_NAMES = ["Average", "Min", "Max", "Sum", "Median", "Range", "Earliest", "Latest", "Checked", "Unchecked", "Empty", "Filled", "Unique"] as const;
export type SummaryName = (typeof SUMMARY_NAMES)[number];

const isEmptyValue = (v: PropValue): boolean => v === null || v === "" || (Array.isArray(v) && v.length === 0);
const round = (n: number): string => String(Math.round(n * 100) / 100);

// Computed over the rows the view holds. The query contract has no summary
// field, so a paged result summarises only the loaded page.
export function summarise(name: string, values: PropValue[]): string | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  const strs = values.filter((v): v is string => typeof v === "string" && v !== "").sort();
  switch (name) {
    case "Sum":
      return nums.length ? round(nums.reduce((a, b) => a + b, 0)) : null;
    case "Average":
      return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
    case "Min":
      return nums.length ? round(Math.min(...nums)) : null;
    case "Max":
      return nums.length ? round(Math.max(...nums)) : null;
    case "Range":
      return nums.length ? round(Math.max(...nums) - Math.min(...nums)) : null;
    case "Median": {
      if (!nums.length) return null;
      const s = [...nums].sort((a, b) => a - b);
      const mid = s.length >> 1;
      return round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
    }
    case "Earliest":
      return strs[0] ?? null;
    case "Latest":
      return strs[strs.length - 1] ?? null;
    case "Checked":
      return String(values.filter((v) => v === true).length);
    case "Unchecked":
      return String(values.filter((v) => v === false).length);
    case "Empty":
      return String(values.filter(isEmptyValue).length);
    case "Filled":
      return String(values.filter((v) => !isEmptyValue(v)).length);
    case "Unique":
      return String(new Set(values.filter((v) => !isEmptyValue(v)).map((v) => JSON.stringify(v))).size);
    default:
      return null;
  }
}

export function sortByColumn(key: string, direction: Direction | null): SortSpec[] {
  return direction === null ? [] : [{ property: key, direction }];
}

export function toggleColumn(order: string[], key: string): string[] {
  const cur = effectiveOrder(order);
  return cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
}

export function moveColumn(order: string[], key: string, delta: -1 | 1): string[] {
  const cur = [...effectiveOrder(order)];
  const i = cur.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return cur;
  [cur[i], cur[j]] = [cur[j]!, cur[i]!];
  return cur;
}

// null: the filter is a tree the simple editor cannot show; edit the source.
export function flatFilters(f: FilterNode | null | undefined): string[] | null {
  if (f === undefined || f === null) return [];
  if (typeof f === "string") return [f];
  if ("and" in f && f.and.every((x) => typeof x === "string")) return f.and as string[];
  return null;
}

export function filtersFrom(list: string[]): FilterNode | null {
  const clean = list.map((s) => s.trim()).filter(Boolean);
  return clean.length === 0 ? null : { and: clean };
}

export function dragStarted(dx: number, dy: number, threshold = 6): boolean {
  return Math.hypot(dx, dy) >= threshold;
}

export interface ColumnRect {
  key: string | null;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// undefined: the pointer is over no column.
export function columnAt(cols: ColumnRect[], x: number, y: number): { key: string | null } | undefined {
  const hit = cols.find((c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom);
  return hit ? { key: hit.key } : undefined;
}

// What a card dropped on a kanban column writes to the group property.
export function moveChange(type: PropertyType | undefined, key: string | null): { set: PropValue } | { unset: true } {
  if (key === null) return { unset: true };
  if (type === "number" && key.trim() !== "" && Number.isFinite(Number(key))) return { set: Number(key) };
  if (type === "checkbox") return { set: key === "true" };
  if (type && LIST_TYPES.includes(type)) return { set: [key] };
  return { set: key };
}

// Where a cards view finds a cover image: an external URL, or a file in the
// note folder's .media directory (the same place Preview looks for embeds).
export function coverSource(notePath: string, value: PropValue): { external: string } | { media: string } | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return { external: t };
  const m = /^!?\[\[([^\]|#]+)/.exec(t);
  const name = (m ? m[1]! : t).trim().split("/").pop()!;
  if (!/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name)) return null;
  const dir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/") + 1) : "";
  return { media: `${dir}.media/${name}` };
}

type ResultRow = BaseQueryResponse["groups"][number]["rows"][number];

// Local update after a kanban move, so the card lands before the refetch.
// A target column that is not on screen leaves the result alone.
export function moveRowInResult(res: BaseQueryResponse, path: string, toKey: string | null): BaseQueryResponse {
  let moved: ResultRow | undefined;
  const groups = res.groups.map((g) => {
    const i = g.rows.findIndex((r) => r.path === path);
    if (i < 0) return g;
    moved = g.rows[i];
    return { ...g, rows: g.rows.filter((_, j) => j !== i), count: g.count - 1 };
  });
  if (!moved) return res;
  const to = groups.findIndex((g) => g.key === toKey);
  if (to >= 0) {
    const g = groups[to]!;
    groups[to] = { ...g, rows: [...g.rows, moved], count: g.count + 1 };
  } else if (toKey === null) {
    groups.push({ key: null, label: "No value", count: 1, rows: [moved] });
  } else {
    return res;
  }
  return { ...res, groups };
}

export function patchRowValues(res: BaseQueryResponse, path: string, patch: Record<string, PropValue>): BaseQueryResponse {
  return {
    ...res,
    groups: res.groups.map((g) => ({
      ...g,
      rows: g.rows.map((r) => (r.path === path ? { ...r, values: { ...r.values, ...patch } } : r)),
    })),
  };
}

export function patchRowRevision(res: BaseQueryResponse, path: string, revision: string): BaseQueryResponse {
  return {
    ...res,
    groups: res.groups.map((g) => ({
      ...g,
      rows: g.rows.map((r) => (r.path === path ? { ...r, revision } : r)),
    })),
  };
}

export const FILE_KEYS = ["file.name", "file.basename", "file.folder", "file.path", "file.ext", "file.size", "file.ctime", "file.mtime", "file.tags", "file.links", "file.backlinks", "file.embeds"];

// Every key a sort, group or column picker can offer.
export function candidateKeys(vaultNames: string[], formulaNames: string[], extra: string[] = []): string[] {
  return [...new Set([...FILE_KEYS, ...vaultNames, ...formulaNames.map((f) => `formula.${f}`), ...extra])];
}

export function formatScalar(col: Pick<BaseQueryResponse["columns"][number], "key" | "type">, v: PropValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && (col.key === "file.ctime" || col.key === "file.mtime" || col.type === "datetime")) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
