export type Align = "left" | "center" | "right" | null;
export interface MdTable {
  header: string[];
  align: Align[];
  rows: string[][];
}
export interface LineRange {
  from: number;
  to: number;
}
export interface RowCell {
  text: string;
  from: number;
  to: number;
}

const FENCE = /^ {0,3}(```|~~~)/;
const DELIM_CELL = /^:?-+:?$/;
const MIN_WIDTH = 3;

function barsOf(line: string): number[] {
  const bars: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") i++;
    else if (ch === "|") bars.push(i);
  }
  return bars;
}

export function splitRow(line: string): RowCell[] {
  const bars = barsOf(line);
  const edges = [-1, ...bars, line.length];
  const cells: RowCell[] = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const a = edges[k]! + 1;
    const b = edges[k + 1]!;
    const raw = line.slice(a, b);
    const text = raw.trim();
    const from = text === "" ? Math.min(a + 1, b) : a + (raw.length - raw.trimStart().length);
    cells.push({ text, from, to: from + text.length });
  }
  if (bars.length > 0) {
    if (line.slice(0, bars[0]).trim() === "") cells.shift();
    if (line.slice(bars[bars.length - 1]! + 1).trim() === "") cells.pop();
  }
  return cells;
}

function isDelimiterRow(line: string): boolean {
  if (!line.includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => DELIM_CELL.test(c.text));
}

function alignOf(text: string): Align {
  const l = text.startsWith(":");
  const r = text.endsWith(":");
  if (l && r) return "center";
  if (l) return "left";
  if (r) return "right";
  return null;
}

function fit<T>(arr: T[], width: number, fill: T): T[] {
  return Array.from({ length: width }, (_, i) => (i < arr.length ? (arr[i] as T) : fill));
}

function normalize(t: MdTable): MdTable {
  const width = Math.max(1, t.header.length, t.align.length, ...t.rows.map((r) => r.length));
  return {
    header: fit(t.header, width, ""),
    align: fit<Align>(t.align, width, null),
    rows: t.rows.map((r) => fit(r, width, "")),
  };
}

export function parseTable(lines: string[]): MdTable | null {
  if (lines.length < 2) return null;
  const first = lines[0]!;
  const second = lines[1]!;
  if (!first.includes("|") || !isDelimiterRow(second)) return null;
  const head = splitRow(first);
  const delim = splitRow(second);
  if (head.length === 0 || head.length !== delim.length) return null;
  return normalize({
    header: head.map((c) => c.text),
    align: delim.map((c) => alignOf(c.text)),
    rows: lines.slice(2).map((l) => splitRow(l).map((c) => c.text)),
  });
}

const vlen = (s: string): number => Array.from(s).length;

function pad(s: string, width: number, align: Align): string {
  const gap = width - vlen(s);
  if (gap <= 0) return s;
  if (align === "right") return " ".repeat(gap) + s;
  if (align === "center") {
    const left = Math.floor(gap / 2);
    return " ".repeat(left) + s + " ".repeat(gap - left);
  }
  return s + " ".repeat(gap);
}

function dashes(width: number, align: Align): string {
  if (align === "center") return `:${"-".repeat(width - 2)}:`;
  if (align === "left") return `:${"-".repeat(width - 1)}`;
  if (align === "right") return `${"-".repeat(width - 1)}:`;
  return "-".repeat(width);
}

export function serializeTable(t: MdTable): string[] {
  const n = normalize(t);
  const widths = n.header.map((h, c) =>
    Math.max(MIN_WIDTH, vlen(h), ...n.rows.map((r) => vlen(r[c] ?? ""))),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((s, c) => pad(s, widths[c]!, n.align[c] ?? null)).join(" | ")} |`;
  return [
    line(n.header),
    `| ${widths.map((w, c) => dashes(w, n.align[c] ?? null)).join(" | ")} |`,
    ...n.rows.map(line),
  ];
}

function inserted<T>(arr: T[], at: number, value: T): T[] {
  const copy = arr.slice();
  copy.splice(at, 0, value);
  return copy;
}

function moved<T>(arr: T[], from: number, to: number): T[] {
  const copy = arr.slice();
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item as T);
  return copy;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

export function setCell(t: MdTable, row: number, col: number, text: string): MdTable {
  const n = normalize(t);
  if (col < 0 || col >= n.header.length) return n;
  if (row === -1) return { ...n, header: n.header.map((c, i) => (i === col ? text : c)) };
  if (!n.rows[row]) return n;
  return { ...n, rows: n.rows.map((r, i) => (i === row ? r.map((c, j) => (j === col ? text : c)) : r)) };
}

export function insertRow(t: MdTable, at: number): MdTable {
  const n = normalize(t);
  return { ...n, rows: inserted(n.rows, clamp(at, 0, n.rows.length), n.header.map(() => "")) };
}

export function deleteRow(t: MdTable, row: number): MdTable {
  const n = normalize(t);
  if (row < 0 || row >= n.rows.length) return n;
  return { ...n, rows: n.rows.filter((_, i) => i !== row) };
}

export function moveRow(t: MdTable, from: number, to: number): MdTable {
  const n = normalize(t);
  const last = n.rows.length - 1;
  if (from === to || from < 0 || from > last || to < 0 || to > last) return n;
  return { ...n, rows: moved(n.rows, from, to) };
}

export function insertColumn(t: MdTable, at: number): MdTable {
  const n = normalize(t);
  const i = clamp(at, 0, n.header.length);
  return {
    header: inserted(n.header, i, ""),
    align: inserted<Align>(n.align, i, null),
    rows: n.rows.map((r) => inserted(r, i, "")),
  };
}

export function deleteColumn(t: MdTable, col: number): MdTable {
  const n = normalize(t);
  if (n.header.length <= 1 || col < 0 || col >= n.header.length) return n;
  const drop = <T>(a: T[]) => a.filter((_, i) => i !== col);
  return { header: drop(n.header), align: drop(n.align), rows: n.rows.map(drop) };
}

export function moveColumn(t: MdTable, from: number, to: number): MdTable {
  const n = normalize(t);
  const last = n.header.length - 1;
  if (from === to || from < 0 || from > last || to < 0 || to > last) return n;
  return {
    header: moved(n.header, from, to),
    align: moved(n.align, from, to),
    rows: n.rows.map((r) => moved(r, from, to)),
  };
}

export function setAlign(t: MdTable, col: number, align: Align): MdTable {
  const n = normalize(t);
  if (col < 0 || col >= n.align.length) return n;
  return { ...n, align: n.align.map((a, i) => (i === col ? align : a)) };
}

const isRowLine = (l: string): boolean => l.trim() !== "" && l.includes("|") && !FENCE.test(l);

// A row line without any pipe also continues a GFM table, but ending the
// table there is the safer side for rewriting: text we do not recognise is
// left alone instead of being reflowed into a cell.
export function findTableAt(lines: string[], lineNo: number): LineRange | null {
  let fence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (FENCE.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const next = lines[i + 1];
    if (next === undefined || !line.includes("|") || !isDelimiterRow(next)) continue;
    if (/^[ \t]/.test(line)) continue;
    if (splitRow(line).length !== splitRow(next).length) continue;
    let end = i + 1;
    while (end + 1 < lines.length && isRowLine(lines[end + 1]!)) end++;
    if (lineNo >= i + 1 && lineNo <= end + 1) return { from: i + 1, to: end + 1 };
    i = end;
  }
  return null;
}

export function columnAt(line: string, offset: number): number {
  const bars = barsOf(line);
  const leading = bars.length > 0 && line.slice(0, bars[0]).trim() === "";
  const before = bars.filter((b) => b < offset).length - (leading ? 1 : 0);
  return Math.max(0, Math.min(before, splitRow(line).length - 1));
}

export function cellRange(line: string, col: number): { from: number; to: number } | null {
  const c = splitRow(line)[col];
  return c ? { from: c.from, to: c.to } : null;
}

export function escapeCell(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, " ").trim();
  let out = "";
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i]!;
    if (ch === "\\") {
      out += ch + (flat[i + 1] ?? "");
      i++;
    } else out += ch === "|" ? "\\|" : ch;
  }
  return out;
}
