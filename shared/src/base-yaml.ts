import { isMap, isScalar, isSeq, parseDocument, stringify, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import type { Direction, FilterNode, SortSpec } from "./base-types";

export class BaseYamlError extends Error {
  constructor(
    readonly code: "INVALID_YAML" | "UNSUPPORTED_STYLE" | "NOT_FOUND" | "CANNOT_DELETE",
    message: string,
  ) {
    super(message);
    this.name = "BaseYamlError";
  }
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

const eolOf = (s: string): string => (s.includes("\r\n") ? "\r\n" : "\n");

function lineStart(s: string, pos: number): number {
  return pos <= 0 ? 0 : s.lastIndexOf("\n", pos - 1) + 1;
}

function lineEnd(s: string, pos: number): number {
  const i = s.indexOf("\n", pos);
  if (i < 0) return s.length;
  return s[i - 1] === "\r" ? i - 1 : i;
}

function render(value: unknown): string {
  return stringify(value, { indent: 2, lineWidth: 0, blockQuote: false }).trimEnd();
}

function indentLines(text: string, indent: string, eol: string, skipFirst: boolean): string {
  return text
    .split("\n")
    .map((l, i) => (i === 0 && skipFirst ? l : indent + l))
    .join(eol);
}

type Rng = [number, number, number];
const rangeOf = (n: unknown): Rng | null => ((n as { range?: Rng | null } | null)?.range ?? null);

function keyName(p: Pair): string | null {
  return isScalar(p.key) ? String(p.key.value) : null;
}

// yaml's value range for a block collection runs past the last line break,
// onto the next line; every end offset is pulled back to the last real character.
function trimEnd(src: string, end: number): number {
  let e = end;
  while (e > 0 && /\s/.test(src[e - 1]!)) e--;
  return e;
}

function pairEnd(src: string, p: Pair): number {
  const v = rangeOf(p.value);
  const k = rangeOf(p.key);
  if (v && v[1] > v[0]) return trimEnd(src, v[1]);
  return src.indexOf(":", k ? k[1] : 0) + 1;
}

function parse(src: string) {
  const doc = parseDocument(src, { keepSourceTokens: true });
  if (doc.errors.length > 0) throw new BaseYamlError("INVALID_YAML", doc.errors[0]!.message);
  return doc;
}

export type Path = Array<string | number>;

function nested(rest: string[], value: unknown): unknown {
  return rest.reduceRight<unknown>((acc, k) => ({ [k]: acc }), value);
}

function appendToMap(src: string, map: YAMLMap, rest: string[], value: unknown): string {
  if (map.flow || map.items.length === 0) {
    throw new BaseYamlError("UNSUPPORTED_STYLE", "inline YAML mappings cannot be edited here");
  }
  const eol = eolOf(src);
  const first = rangeOf(map.items[0]!.key)![0];
  const indent = " ".repeat(first - lineStart(src, first));
  const at = lineEnd(src, pairEnd(src, map.items[map.items.length - 1]!));
  const text = indentLines(render(nested(rest, value)), indent, eol, false);
  return src.slice(0, at) + eol + text + src.slice(at);
}

const isEmpty = (v: unknown): boolean => typeof v === "object" && v !== null && Object.keys(v).length === 0;

// Removing the last entry of a map leaves its key with a null value in the source.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null && isEmpty(b)) || (b === null && isEmpty(a))) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

// A splice is a text hack; this proves it did what the parsed document says
// it should, or the edit is refused instead of corrupting the base.
function verified(src: string, out: string, apply: (doc: ReturnType<typeof parse>) => void): string {
  const expected = parse(src);
  apply(expected);
  const actual = parseDocument(out);
  if (actual.errors.length > 0 || !same(expected.toJS(), actual.toJS())) {
    throw new BaseYamlError("UNSUPPORTED_STYLE", "this edit cannot be applied safely to the source as written");
  }
  return out;
}

// Sets, replaces or (value undefined) deletes the node at `path`, touching
// only the bytes of that pair. Document.toString() would re-indent and
// re-quote the whole source, so every edit splices by node range instead.
export function setPath(src: string, path: Path, value: unknown): string {
  const out = spliceSetPath(src, path, value);
  return verified(src, out, (doc) => {
    if (value === undefined) doc.deleteIn(path);
    else doc.setIn(path, value);
  });
}

const isNullNode = (n: unknown): boolean => n === null || n === undefined || (isScalar(n) && n.value === null);

function rejectFabricated(rest: Path): void {
  if (rest.some((k) => typeof k === "number")) {
    throw new BaseYamlError("NOT_FOUND", `no list item at ${rest.map(String).join(".")}`);
  }
}

function spliceSetPath(src: string, path: Path, value: unknown): string {
  const doc = parse(src);
  const eol = eolOf(src);
  let node: unknown = doc.contents;
  if (isNullNode(node)) {
    if (value === undefined) return src;
    rejectFabricated(path);
    const body = render(nested(path.map(String), value));
    return body.split("\n").join(eol) + eol + (src.trim() === "" ? "" : src);
  }
  for (let i = 0; i < path.length; i++) {
    const key = path[i]!;
    const last = i === path.length - 1;
    if (isSeq(node)) {
      const item = (node as YAMLSeq).items[key as number];
      if (item === undefined) throw new BaseYamlError("NOT_FOUND", `no item ${String(key)}`);
      if (last) throw new BaseYamlError("UNSUPPORTED_STYLE", "use addView or deleteView for list items");
      node = item;
      continue;
    }
    if (!isMap(node)) throw new BaseYamlError("UNSUPPORTED_STYLE", "expected a mapping");
    const map = node as YAMLMap;
    const pair = map.items.find((p) => keyName(p) === String(key));
    if (!pair) {
      if (value === undefined) return src;
      rejectFabricated(path.slice(i));
      return appendToMap(src, map, path.slice(i).map(String), value);
    }
    const v = pair.value;
    if (!last && (isMap(v) || isSeq(v))) {
      node = v;
      continue;
    }
    const kr = rangeOf(pair.key)!;
    const end = pairEnd(src, pair);
    if (last && value === undefined) {
      const ls = lineStart(src, kr[0]);
      if (src.slice(ls, kr[0]).trim() !== "") {
        throw new BaseYamlError("CANNOT_DELETE", `"${String(key)}" shares a line with a list marker`);
      }
      let le = lineEnd(src, end);
      if (src[le] === "\r") le += 1;
      if (src[le] === "\n") le += 1;
      return src.slice(0, ls) + src.slice(le);
    }
    if (!last) {
      if (value === undefined) return src;
      if (!isNullNode(v)) throw new BaseYamlError("UNSUPPORTED_STYLE", `"${String(key)}" is not a mapping or list`);
      rejectFabricated(path.slice(i + 1));
    }
    const indent = " ".repeat(kr[0] - lineStart(src, kr[0]));
    const text = indentLines(render(nested(path.slice(i).map(String), value)), indent, eol, true);
    const vr = rangeOf(v);
    const plain = last && isScalar(v) && vr && vr[1] > vr[0] && typeof value !== "object" && !String(v.type).startsWith("BLOCK");
    if (plain) {
      const scalar = render(value);
      if (!scalar.includes("\n")) return src.slice(0, vr![0]) + scalar + src.slice(vr![1]);
    }
    return src.slice(0, kr[0]) + text + src.slice(end);
  }
  return src;
}

export const setViewKey = (src: string, view: number, key: string, value: unknown): string =>
  setPath(src, ["views", view, key], value);

export const setViewSort = (src: string, view: number, sort: SortSpec[]): string =>
  setViewKey(src, view, "sort", sort.length > 0 ? sort : undefined);

export const setViewFilters = (src: string, view: number, filters: FilterNode | null): string =>
  setViewKey(src, view, "filters", filters ?? undefined);

export const setViewOrder = (src: string, view: number, order: string[]): string =>
  setViewKey(src, view, "order", order.length > 0 ? order : undefined);

export const setViewGroupBy = (
  src: string,
  view: number,
  groupBy: { property: string; direction: Direction } | null,
): string => setViewKey(src, view, "groupBy", groupBy ?? undefined);

export const setViewType = (src: string, view: number, type: string): string => setViewKey(src, view, "type", type);

export const renameView = (src: string, view: number, name: string): string => setViewKey(src, view, "name", name);

// Obsidian keys columnSize by the prefixed id (`note.status`) even when `order` lists the bare name.
export const columnId = (key: string): string => (/^(note|file|formula)\./.test(key) ? key : `note.${key}`);

export const setColumnSize = (src: string, view: number, column: string, px: number): string =>
  setPath(src, ["views", view, "columnSize", columnId(column)], Math.round(px));

export const setViewSummary = (src: string, view: number, column: string, summary: string | null): string =>
  setPath(src, ["views", view, "summaries", column], summary ?? undefined);

export const setColumnLabel = (src: string, column: string, label: string): string =>
  setPath(src, ["properties", column, "displayName"], label);

export function addView(src: string, view: { type: string; name: string }): string {
  const out = spliceAddView(src, view);
  return verified(src, out, (doc) => {
    const views = doc.getIn(["views"]);
    if (isSeq(views) && views.items.length > 0) views.add(doc.createNode(view));
    else doc.setIn(["views"], [view]);
  });
}

function spliceAddView(src: string, view: { type: string; name: string }): string {
  const doc = parse(src);
  const root = doc.contents;
  const views = isMap(root) ? (root as YAMLMap).items.find((p) => keyName(p) === "views")?.value : null;
  if (!isSeq(views) && !isNullNode(views)) {
    throw new BaseYamlError("UNSUPPORTED_STYLE", "views is not a list");
  }
  if (!isSeq(views) || (views.flow && views.items.length === 0)) return spliceSetPath(src, ["views"], [view]);
  const seq = views as YAMLSeq;
  if (seq.flow || seq.items.length === 0) {
    throw new BaseYamlError("UNSUPPORTED_STYLE", "inline view lists cannot be edited here");
  }
  const eol = eolOf(src);
  const first = rangeOf(seq.items[0])![0];
  const ls = lineStart(src, first);
  const dash = src.slice(ls, first).lastIndexOf("-");
  const indent = " ".repeat(dash < 0 ? first - ls : dash);
  const lastEnd = trimEnd(src, rangeOf(seq.items[seq.items.length - 1])![1]);
  const at = lineEnd(src, lastEnd);
  return src.slice(0, at) + eol + indentLines(render([view]), indent, eol, false) + src.slice(at);
}

export function deleteView(src: string, index: number): string {
  const out = spliceDeleteView(src, index);
  return verified(src, out, (doc) => {
    doc.deleteIn(["views", index]);
  });
}

function spliceDeleteView(src: string, index: number): string {
  const doc = parse(src);
  const root = doc.contents;
  const views = isMap(root) ? (root as YAMLMap).items.find((p) => keyName(p) === "views")?.value : null;
  if (!isSeq(views)) throw new BaseYamlError("NOT_FOUND", "no views list");
  if ((views as YAMLSeq).flow) throw new BaseYamlError("UNSUPPORTED_STYLE", "inline view lists cannot be edited here");
  const item = (views as YAMLSeq).items[index];
  if (!item) throw new BaseYamlError("NOT_FOUND", `no view ${index}`);
  const r = rangeOf(item)!;
  const ls = lineStart(src, r[0]);
  if (src.slice(ls, r[0]).trim() !== "-") throw new BaseYamlError("UNSUPPORTED_STYLE", "view does not start on its own list line");
  let le = lineEnd(src, trimEnd(src, r[1]));
  if (src[le] === "\r") le += 1;
  if (src[le] === "\n") le += 1;
  return src.slice(0, ls) + src.slice(le);
}

export interface BaseFence {
  startLine: number;
  endLine: number;
  closed: boolean;
  indent: string;
  from: number;
  to: number;
  source: string;
}

const FM = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function findBaseFences(content: string): BaseFence[] {
  const fm = content.match(FM);
  const lines = content.split("\n");
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  const out: BaseFence[] = [];
  let i = fm ? fm[0].split("\n").length - (fm[0].endsWith("\n") ? 1 : 0) : 0;
  while (i < lines.length) {
    const open = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/.exec(lines[i]!.replace(/\r$/, ""));
    if (!open) {
      i++;
      continue;
    }
    const indent = open[1]!;
    const marker = open[2]!;
    const isBase = open[3]!.toLowerCase() === "base";
    const closeRe = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j]!.replace(/\r$/, ""))) j++;
    const closed = j < lines.length;
    if (isBase) {
      const bodyFirst = i + 1;
      // Unclosed: the "" after the note's final newline is not a body line;
      // the renderer leaves it out too, and the two must agree on the source.
      const end = closed ? j : lines.length > bodyFirst && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
      const bodyLast = end - 1;
      const from = bodyFirst <= bodyLast ? offsets[bodyFirst]! : closed ? offsets[j]! : content.length;
      const to =
        bodyFirst <= bodyLast
          ? offsets[bodyLast]! + lines[bodyLast]!.replace(/\r$/, "").length
          : from;
      const source = bodyFirst <= bodyLast
        ? lines
            .slice(bodyFirst, bodyLast + 1)
            .map((l) => l.replace(/\r$/, "").replace(new RegExp(`^ {0,${indent.length}}`), ""))
            .join("\n")
        : "";
      out.push({ startLine: i + 1, endLine: (closed ? j : lines.length - 1) + 1, closed, indent, from, to, source });
    }
    i = closed ? j + 1 : lines.length;
  }
  return out;
}

export function replaceFenceBody(content: string, fence: BaseFence, source: string): TextEdit {
  const eol = eolOf(content);
  const lines = source.replace(/\s+$/, "").split(/\r?\n/).map((l) => (l === "" ? l : fence.indent + l));
  const empty = fence.from === fence.to;
  return { from: fence.from, to: fence.to, insert: lines.join(eol) + (empty ? eol : "") };
}
