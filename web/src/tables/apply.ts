import { parseTable, serializeTable, type LineRange, type MdTable } from "./md-table";

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

interface Located {
  from: number;
  to: number;
  lines: string[];
  eol: string;
}

function locate(text: string, range: LineRange): Located | null {
  const parts = text.split("\n");
  if (range.from < 1 || range.to < range.from || range.to > parts.length) return null;
  let from = 0;
  for (let i = 0; i < range.from - 1; i++) from += parts[i]!.length + 1;
  const slice = parts.slice(range.from - 1, range.to);
  const last = slice[slice.length - 1]!;
  const to = from + slice.join("\n").length - (last.endsWith("\r") ? 1 : 0);
  return {
    from,
    to,
    lines: slice.map((l) => l.replace(/\r$/, "")),
    eol: slice[0]!.endsWith("\r") ? "\r\n" : "\n",
  };
}

export function readTable(text: string, range: LineRange): MdTable | null {
  const loc = locate(text, range);
  return loc ? parseTable(loc.lines) : null;
}

export function tableEdit(text: string, range: LineRange, fn: (t: MdTable) => MdTable): TextEdit | null {
  const loc = locate(text, range);
  if (!loc) return null;
  const model = parseTable(loc.lines);
  if (!model) return null;
  const insert = serializeTable(fn(model)).join(loc.eol);
  if (insert === text.slice(loc.from, loc.to)) return { from: loc.from, to: loc.from, insert: "" };
  return { from: loc.from, to: loc.to, insert };
}

export function applyEdit(text: string, edit: TextEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}
