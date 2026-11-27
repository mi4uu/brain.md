import type { BaseQueryResponse, Direction, FilterNode, SortSpec } from "@brainmd/shared/base-types";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { DATETIME_RE, DATE_RE } from "@brainmd/shared/property-types";
import { columnId } from "@brainmd/shared/base-yaml";
import { cleanItem, fitsType, isListType, isNested } from "../properties/model";

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

// A list cell is edited as comma-joined text, so it is editable only when that
// text reads back as exactly the stored items.
const isItem = (type: PropertyType, x: string): boolean => x !== "" && !/[,\r\n]/.test(x) && cleanItem(type, x) === x;

function listRoundTrips(type: PropertyType, value: PropValue): boolean {
  if (value === null) return true;
  if (typeof value === "string") return isItem(type, value);
  return Array.isArray(value) && value.every((x) => typeof x === "string" && isItem(type, x));
}

// `partial` is the row's list of cells the server altered (dropped links, cut
// text, nulled past the budget); writing one back would persist the loss.
export function isEditable(type: ColumnType, key: string, value: PropValue, partial?: readonly string[]): boolean {
  if (type === "file" || type === "formula" || propNameOf(key) === null || isNested(value)) return false;
  if (partial?.includes(key)) return false;
  if (isListType(type)) return listRoundTrips(type, value);
  if (type === "number" && value !== null && !(typeof value === "number" && Number.isFinite(value))) return false;
  return fitsType(type, value);
}

export type Coerced = { kind: "set"; value: PropValue } | { kind: "unset" } | { kind: "error"; message: string };

export function coerceInput(type: PropertyType, raw: string): Coerced {
  const text = raw.trim();
  if (isListType(type)) {
    const items = text.split(",").map((s) => cleanItem(type, s)).filter(Boolean);
    return items.length === 0 ? { kind: "unset" } : { kind: "set", value: items };
  }
  if (text === "") return { kind: "unset" };
  if (type === "number") {
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) return { kind: "error", message: "Not a number" };
    const n = Number(text);
    if (!Number.isFinite(n) || (!text.includes(".") && !Number.isSafeInteger(n))) return { kind: "error", message: "Number too large to keep exactly" };
    return { kind: "set", value: n };
  }
  if (type === "checkbox") {
    if (/^(true|yes|1|on)$/i.test(text)) return { kind: "set", value: true };
    if (/^(false|no|0|off)$/i.test(text)) return { kind: "set", value: false };
    return { kind: "error", message: "Not true or false" };
  }
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
function instant(v: string): number | null {
  if (!DATE_RE.test(v) && !DATETIME_RE.test(v)) return null;
  const t = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(t) ? null : t;
}
const round = (n: number): string => String(Math.round(n * 100) / 100);

// Computed over the rows the view holds. The query contract has no summary
// field, so a paged result summarises only the loaded page.
export function summarise(name: string, values: PropValue[]): string | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  const dated = (): string[] =>
    values
      .filter((v): v is string => typeof v === "string" && instant(v) !== null)
      .sort((a, b) => instant(a)! - instant(b)!);
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
      return dated()[0] ?? null;
    case "Latest":
      return dated().at(-1) ?? null;
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
// The typed value is used only when it spells back as the column key, so "007"
// stays text. null: the property is a list, which a move would flatten.
export function moveChange(type: PropertyType | undefined, key: string | null): { set: PropValue } | { unset: true } | null {
  if (type && isListType(type)) return null;
  return presetValue(type, key) as { set: PropValue } | { unset: true };
}

// What the "+" in a column presets on a new card: unlike a move, a list
// property gets a one-item list.
// null: a list group key that is itself a joined list ("a, b") has no single item to preset.
export function presetValue(type: PropertyType | undefined, key: string | null): { set: PropValue } | { unset: true } | null {
  if (key === null) return { unset: true };
  if (type && isListType(type)) return key.includes(", ") ? null : { set: [key] };
  if (type === "number" && String(Number(key)) === key) return { set: Number(key) };
  if (type === "checkbox" && (key === "true" || key === "false")) return { set: key === "true" };
  return { set: key };
}

// Whether a card can be moved by rewriting its group property.
export function canMove(type: PropertyType | undefined, value: PropValue, partial?: boolean): boolean {
  if (partial) return false;
  if (type && isListType(type)) return false;
  return !Array.isArray(value) && !isNested(value);
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
  if (typeof v === "string" && (col.key === "file.ctime" || col.key === "file.mtime" || (col.type === "datetime" && DATETIME_RE.test(v)))) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

// A native date or datetime-local input only when the stored text is in its own format; anything else stays text so the original is never rewritten.
export function cellInputType(type: PropertyType, value: PropValue): "number" | "date" | "datetime-local" | "text" {
  if (type === "number") return "number";
  if (type === "date" && (value === null || (typeof value === "string" && DATE_RE.test(value)))) return "date";
  if (type === "datetime" && (value === null || (typeof value === "string" && LOCAL_DATETIME_RE.test(value)))) return "datetime-local";
  return "text";
}

export type CellCommit = { kind: "write"; change: { set: PropValue } | { unset: true } } | { kind: "skip" } | { kind: "conflict" } | { kind: "error"; message: string };

// `opened` is what the editor showed when it opened; `current` is what the row holds now.
export function cellCommit(opened: { text: string }, current: { value: PropValue }, raw: string, type: PropertyType): CellCommit {
  if (raw === opened.text) return { kind: "skip" };
  if (editText(current.value) !== opened.text) return { kind: "conflict" };
  const c = coerceInput(type, raw);
  if (c.kind === "error") return { kind: "error", message: c.message };
  if (c.kind === "unset") return current.value === null ? { kind: "skip" } : { kind: "write", change: { unset: true } };
  if (JSON.stringify(c.value) === JSON.stringify(current.value)) return { kind: "skip" };
  return { kind: "write", change: { set: c.value } };
}

export function byColumn<T>(map: Record<string, T>, key: string): T | undefined {
  const id = columnId(key);
  for (const k of Object.keys(map)) if (columnId(k) === id) return map[k];
  return undefined;
}
