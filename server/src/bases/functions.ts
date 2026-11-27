import type { PropValue } from "@brainmd/shared/frontmatter";

export class DateValue {
  constructor(
    readonly ms: number,
    readonly time: boolean,
  ) {}
}

export class LinkValue {
  constructor(
    readonly path: string,
    readonly display?: string,
  ) {}
}

export class FormulaRoot {}

export interface FileData {
  path: string;
  size: number;
  ctime: number;
  mtime: number;
  tags: string[];
  props: Record<string, PropValue>;
}

export interface FileHost {
  resolveLink(fromPath: string, target: string): string | undefined;
  // Links the caller may see: a link to a note the caller cannot read is gone.
  outLinks(path: string): Array<{ text: string; path: string | null; embed: boolean }>;
  backlinks(path: string): string[];
}

export class FileObject {
  private cache = new Map<string, Value>();
  constructor(
    readonly data: FileData,
    readonly host: FileHost,
  ) {}

  get folder(): string {
    const i = this.data.path.lastIndexOf("/");
    return i < 0 ? "" : this.data.path.slice(0, i);
  }

  get basename(): string {
    const base = this.data.path.slice(this.data.path.lastIndexOf("/") + 1);
    return base.replace(/\.md$/i, "");
  }

  get(name: string): Value {
    const hit = this.cache.get(name);
    if (hit !== undefined) return hit;
    const v = this.compute(name);
    this.cache.set(name, v);
    return v;
  }

  private compute(name: string): Value {
    const d = this.data;
    switch (name) {
      case "name":
        return `${this.basename}.md`;
      case "basename":
        return this.basename;
      case "fullname":
        return `${this.basename}.md`;
      case "path":
        return d.path;
      case "folder":
        // Obsidian shows the vault root as "/".
        return this.folder === "" ? "/" : this.folder;
      case "ext":
        return "md";
      case "size":
        return d.size;
      case "ctime":
        return new DateValue(d.ctime, true);
      case "mtime":
        return new DateValue(d.mtime, true);
      case "tags":
        return [...d.tags];
      case "links":
        return this.host.outLinks(d.path).filter((l) => !l.embed).map((l) => new LinkValue(l.path ?? l.text));
      case "embeds":
        return this.host.outLinks(d.path).filter((l) => l.embed).map((l) => new LinkValue(l.path ?? l.text));
      case "backlinks":
        return this.host.backlinks(d.path).map((p) => new LinkValue(p));
      case "properties":
        return d.props as Value;
      default:
        return null;
    }
  }
}

export type Value = null | boolean | number | string | Value[] | { [k: string]: Value } | DateValue | LinkValue | FileObject | FormulaRoot;

export const UNSUPPORTED = Symbol("unsupported");

export interface FnCtx {
  now: Date;
  warn(message: string): void;
}

export type Kind = "null" | "boolean" | "number" | "string" | "list" | "object" | "date" | "link" | "file" | "other";

export function kindOf(v: Value): Kind {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "list";
  if (v instanceof DateValue) return "date";
  if (v instanceof LinkValue) return "link";
  if (v instanceof FileObject) return "file";
  if (v instanceof FormulaRoot) return "other";
  return "object";
}

export function truthy(v: Value): boolean {
  switch (kindOf(v)) {
    case "null":
      return false;
    case "boolean":
      return v as boolean;
    case "number":
      return (v as number) !== 0 && !Number.isNaN(v);
    case "string":
      return (v as string) !== "";
    case "list":
      return (v as Value[]).length > 0;
    default:
      return true;
  }
}

const stripMd = (p: string): string => p.replace(/\.md$/i, "");

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

export function formatDate(d: DateValue, fmt: string): string {
  const x = new Date(d.ms);
  const parts: Record<string, string> = {
    YYYY: pad(x.getFullYear(), 4),
    MM: pad(x.getMonth() + 1),
    DD: pad(x.getDate()),
    HH: pad(x.getHours()),
    mm: pad(x.getMinutes()),
    ss: pad(x.getSeconds()),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => parts[t]!);
}

export function parseDate(s: string): DateValue | null {
  const text = s.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(text);
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(2000, 0, 1);
  probe.setFullYear(y, mo - 1, da);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== da) return null;
  if (m[4] === undefined) return new DateValue(probe.getTime(), false);
  const [h, mi, sec] = [Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  if (h > 23 || mi > 59 || sec > 59) return null;
  let ms: number;
  if (m[8]) ms = Date.parse(text.replace(" ", "T"));
  else {
    const local = new Date(2000, 0, 1, h, mi, sec, Number((m[7] ?? "0").padEnd(3, "0")));
    local.setFullYear(y, mo - 1, da);
    ms = local.getTime();
  }
  return Number.isFinite(ms) ? new DateValue(ms, true) : null;
}

export function coerceDate(v: Value): DateValue | null {
  if (v instanceof DateValue) return v;
  if (typeof v === "string") return parseDate(v);
  return null;
}

const UNIT: Record<string, "y" | "M" | "w" | "d" | "h" | "m" | "s"> = {
  y: "y", year: "y", years: "y",
  M: "M", month: "M", months: "M",
  w: "w", week: "w", weeks: "w",
  d: "d", day: "d", days: "d",
  h: "h", hour: "h", hours: "h",
  m: "m", min: "m", mins: "m", minute: "m", minutes: "m",
  s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
};

const DURATION_RE = /^-?\d+(?:\.\d+)?\s*[A-Za-z]+(?:[\s,]*\d+(?:\.\d+)?\s*[A-Za-z]+)*$/;

function shiftMonths(x: Date, months: number): void {
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + months);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
}

export function addDuration(d: DateValue, spec: string, sign: 1 | -1): DateValue | null {
  const text = spec.trim();
  if (text.length > 64 || !DURATION_RE.test(text)) return null;
  const sgn = text.startsWith("-") ? -sign : sign;
  const x = new Date(d.ms);
  let time = d.time;
  for (const m of text.replace(/^-/, "").matchAll(/(\d+(?:\.\d+)?)\s*([A-Za-z]+)/g)) {
    const unit = UNIT[m[2]!];
    if (!unit) return null;
    const n = Number(m[1]) * sgn;
    if (unit === "y") shiftMonths(x, Math.trunc(n) * 12);
    else if (unit === "M") shiftMonths(x, Math.trunc(n));
    else if (unit === "w") x.setDate(x.getDate() + n * 7);
    else if (unit === "d") x.setDate(x.getDate() + n);
    else {
      time = true;
      x.setTime(x.getTime() + n * (unit === "h" ? 3600000 : unit === "m" ? 60000 : 1000));
    }
  }
  const ms = x.getTime();
  return Number.isFinite(ms) ? new DateValue(ms, time) : null;
}

export function toStr(v: Value): string {
  switch (kindOf(v)) {
    case "null":
      return "";
    case "list":
      return (v as Value[]).map(toStr).join(", ");
    case "date":
      return toProp(v) as string;
    case "link":
      return `[[${stripMd((v as LinkValue).path)}]]`;
    case "file":
      return (v as FileObject).data.path;
    case "object":
      return JSON.stringify(toProp(v));
    case "other":
      return "";
    default:
      return String(v);
  }
}

// JSON-safe form of any value: what a query puts in a cell.
export function toProp(v: Value, depth = 0): PropValue {
  if (depth > 6) return null;
  switch (kindOf(v)) {
    case "null":
    case "other":
      return null;
    case "date": {
      const d = v as DateValue;
      if (!Number.isFinite(d.ms)) return null;
      return d.time ? new Date(d.ms).toISOString() : formatDate(d, "YYYY-MM-DD");
    }
    case "link":
      return `[[${stripMd((v as LinkValue).path)}]]`;
    case "file":
      return `[[${stripMd((v as FileObject).data.path)}]]`;
    case "list":
      return (v as Value[]).map((x) => toProp(x, depth + 1));
    case "object": {
      const out: Record<string, PropValue> = Object.create(null);
      for (const k of Object.keys(v as object)) out[k] = toProp((v as Record<string, Value>)[k]!, depth + 1);
      return out;
    }
    default:
      return typeof v === "number" && !Number.isFinite(v) ? null : (v as PropValue);
  }
}

const normLink = (p: string): string => stripMd(p.trim()).toLowerCase();

// "[[target|alias]]" and "[[target#heading]]" reduce to the target.
function wikiTarget(t: string): string | null {
  const m = /^\[\[([^\]]*)\]\]$/.exec(t.trim());
  return m ? m[1]!.split("|")[0]!.split("#")[0]!.trim() : null;
}

function linkKey(v: Value): string | null {
  if (v instanceof LinkValue) return normLink(v.path);
  if (v instanceof FileObject) return normLink(v.data.path);
  if (typeof v === "string") {
    const t = wikiTarget(v);
    return t === null ? null : normLink(t);
  }
  return null;
}

const baseOf = (k: string): string => k.slice(k.lastIndexOf("/") + 1);

function sameLink(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a.includes("/")) return a === baseOf(b);
  if (!b.includes("/")) return b === baseOf(a);
  return false;
}

const isLinkObject = (v: Value): boolean => v instanceof LinkValue || v instanceof FileObject;

export function looseEq(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b;
  if (a instanceof DateValue || b instanceof DateValue) {
    const x = coerceDate(a);
    const y = coerceDate(b);
    return x !== null && y !== null && x.ms === y.ms;
  }
  if (isLinkObject(a) || isLinkObject(b)) {
    const la = linkKey(a);
    const lb = linkKey(b);
    return la !== null && lb !== null && sameLink(la, lb);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => looseEq(x, b[i]!));
  }
  return a === b;
}

// null: the two values have no order (mixed kinds).
export function compareValues(a: Value, b: Value): number | null {
  if (a instanceof DateValue || b instanceof DateValue) {
    const x = coerceDate(a);
    const y = coerceDate(b);
    return x && y ? x.ms - y.ms : null;
  }
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    const x = parseDate(a);
    const y = parseDate(b);
    if (x && y) return x.ms - y.ms;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return null;
}

type Fn = (recv: Value, args: Value[], c: FnCtx) => Value;
const strArgs = (args: Value[]): string[] => args.filter((a): a is string => typeof a === "string");
const normTag = (t: string): string => t.replace(/^#/, "").toLowerCase();

function isEmptyValue(v: Value): boolean {
  switch (kindOf(v)) {
    case "null":
      return true;
    case "string":
      return v === "";
    case "list":
      return (v as Value[]).length === 0;
    case "object":
      return Object.keys(v as object).length === 0;
    default:
      return false;
  }
}

const anyMethods = new Map<string, Fn>([
  ["isTruthy", (r) => truthy(r)],
  ["toString", (r) => toStr(r)],
  ["isEmpty", (r) => isEmptyValue(r)],
]);

const stringMethods = new Map<string, Fn>([
  ["contains", (r, a) => typeof a[0] === "string" && (r as string).includes(a[0])],
  ["containsAll", (r, a) => strArgs(a).length === a.length && a.every((x) => (r as string).includes(x as string))],
  ["containsAny", (r, a) => strArgs(a).some((x) => (r as string).includes(x))],
  ["startsWith", (r, a) => typeof a[0] === "string" && (r as string).startsWith(a[0])],
  ["endsWith", (r, a) => typeof a[0] === "string" && (r as string).endsWith(a[0])],
  ["lower", (r) => (r as string).toLowerCase()],
  ["upper", (r) => (r as string).toUpperCase()],
  ["trim", (r) => (r as string).trim()],
]);

const listMethods = new Map<string, Fn>([
  ["contains", (r, a) => (r as Value[]).some((x) => looseEq(x, a[0] ?? null))],
  ["containsAll", (r, a) => a.every((v) => (r as Value[]).some((x) => looseEq(x, v)))],
  ["containsAny", (r, a) => a.some((v) => (r as Value[]).some((x) => looseEq(x, v)))],
]);

const dateMethods = new Map<string, Fn>([
  ["format", (r, a) => formatDate(r as DateValue, typeof a[0] === "string" ? a[0] : "YYYY-MM-DD")],
]);

const fileMethods = new Map<string, Fn>([
  [
    "hasTag",
    (r, a) => {
      const tags = (r as FileObject).data.tags.map(normTag);
      return strArgs(a)
        .map(normTag)
        .some((w) => tags.some((t) => t === w || t.startsWith(`${w}/`)));
    },
  ],
  [
    "inFolder",
    (r, a) => {
      const f = typeof a[0] === "string" ? a[0].replace(/^\/+|\/+$/g, "") : null;
      if (f === null) return false;
      const folder = (r as FileObject).folder;
      return f === "" || folder === f || folder.startsWith(`${f}/`);
    },
  ],
  [
    "hasLink",
    (r, a) => {
      const file = r as FileObject;
      const arg = a[0] ?? null;
      let text: string | null = null;
      if (typeof arg === "string") text = wikiTarget(arg) ?? arg.split("|")[0]!.split("#")[0]!.trim();
      else if (arg instanceof LinkValue) text = stripMd(arg.path);
      else if (arg instanceof FileObject) text = stripMd(arg.data.path);
      if (text === null) return false;
      const target = file.host.resolveLink(file.data.path, text) ?? null;
      const key = normLink(text);
      return file.host
        .outLinks(file.data.path)
        .some(
          (l) =>
            (l.path !== null && (l.path === target || normLink(l.path) === key)) || l.text.toLowerCase() === text.toLowerCase(),
        );
    },
  ],
  ["hasProperty", (r, a) => typeof a[0] === "string" && Object.hasOwn((r as FileObject).data.props, a[0])],
]);

const methodTables = new Map<Kind, Map<string, Fn>>([
  ["string", stringMethods],
  ["list", listMethods],
  ["date", dateMethods],
  ["file", fileMethods],
]);

export function callMethod(recv: Value, name: string, args: Value[], c: FnCtx): Value | typeof UNSUPPORTED {
  const kind = kindOf(recv);
  const fn = methodTables.get(kind)?.get(name) ?? anyMethods.get(name);
  if (fn) return fn(recv, args, c);
  // A missing property is common and not a mistake: stay quiet on null.
  return kind === "null" ? null : UNSUPPORTED;
}

const globalFns = new Map<string, (args: Value[], c: FnCtx) => Value>([
  ["now", (_a, c) => new DateValue(c.now.getTime(), true)],
  ["today", (_a, c) => new DateValue(new Date(c.now.getFullYear(), c.now.getMonth(), c.now.getDate()).getTime(), false)],
  ["date", (a) => coerceDate(a[0] ?? null)],
  ["link", (a) => (a[0] === null || a[0] === undefined ? null : new LinkValue(toStr(a[0]), typeof a[1] === "string" ? a[1] : undefined))],
]);

export function callGlobal(name: string, args: Value[], c: FnCtx): Value | typeof UNSUPPORTED {
  const fn = globalFns.get(name);
  return fn ? fn(args, c) : UNSUPPORTED;
}
