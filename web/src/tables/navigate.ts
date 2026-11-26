import { locateRange } from "./apply";
import {
  cellRange,
  columnAt,
  findTableAt,
  insertRow,
  parseTable,
  serializeTable,
  type MdTable,
} from "./md-table";

export interface CursorEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

interface Ctx {
  original: string;
  start: number;
  end: number;
  eol: string;
  model: MdTable;
  row: number;
  col: number;
  delimiter: boolean;
}

function locate(text: string, pos: number): Ctx | null {
  const parts = text.split("\n");
  let offset = 0;
  let lineIdx = 0;
  while (lineIdx < parts.length - 1 && offset + parts[lineIdx]!.length + 1 <= pos) {
    offset += parts[lineIdx]!.length + 1;
    lineIdx++;
  }
  const clean = parts.map((l) => l.replace(/\r$/, ""));
  const range = findTableAt(clean, lineIdx + 1);
  if (!range) return null;
  const loc = locateRange(text, range);
  if (!loc) return null;
  const model = parseTable(loc.lines);
  if (!model) return null;
  const rowLine = lineIdx + 1 - range.from;
  return {
    original: text.slice(loc.from, loc.to),
    start: loc.from,
    end: loc.to,
    eol: loc.eol,
    model,
    row: rowLine <= 1 ? -1 : rowLine - 2,
    col: Math.min(columnAt(clean[lineIdx]!, pos - offset), model.header.length - 1),
    delimiter: rowLine === 1,
  };
}

function finish(ctx: Ctx, model: MdTable, target: { row: number; col: number }, select: boolean): CursorEdit {
  const lines = serializeTable(model);
  const insert = lines.join(ctx.eol);
  const idx = target.row < 0 ? 0 : target.row + 2;
  let base = ctx.start;
  for (let i = 0; i < idx; i++) base += lines[i]!.length + ctx.eol.length;
  const r = cellRange(lines[idx]!, target.col) ?? { from: 0, to: 0 };
  const anchor = base + r.from;
  const head = select ? base + r.to : anchor;
  if (insert === ctx.original) return { from: ctx.start, to: ctx.start, insert: "", anchor, head };
  return { from: ctx.start, to: ctx.end, insert, anchor, head };
}

export function tabEdit(text: string, pos: number, dir: 1 | -1): CursorEdit | null {
  const ctx = locate(text, pos);
  if (!ctx) return null;
  const width = ctx.model.header.length;
  let { row, col } = ctx;
  if (ctx.delimiter) {
    if (dir > 0) col = width - 1;
    else {
      row = 0;
      col = 0;
    }
  }
  const next = (row + 1) * width + col + dir;
  if (next < 0) return finish(ctx, ctx.model, { row: -1, col: 0 }, true);
  if (next >= (ctx.model.rows.length + 1) * width) {
    const grown = insertRow(ctx.model, ctx.model.rows.length);
    return finish(ctx, grown, { row: ctx.model.rows.length, col: 0 }, false);
  }
  return finish(ctx, ctx.model, { row: Math.floor(next / width) - 1, col: next % width }, true);
}

export function enterEdit(text: string, pos: number): CursorEdit | null {
  const ctx = locate(text, pos);
  if (!ctx) return null;
  if (ctx.row + 1 < ctx.model.rows.length) {
    return finish(ctx, ctx.model, { row: ctx.row + 1, col: ctx.col }, true);
  }
  const grown = insertRow(ctx.model, ctx.model.rows.length);
  return finish(ctx, grown, { row: ctx.model.rows.length, col: ctx.col }, false);
}

export function formatEdit(text: string, pos: number): CursorEdit | null {
  const ctx = locate(text, pos);
  if (!ctx) return null;
  return finish(ctx, ctx.model, { row: ctx.row, col: ctx.col }, false);
}
