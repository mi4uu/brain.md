import { isMap, isScalar, isSeq, parseDocument, stringify, type Document, type Pair, type YAMLMap } from "yaml";

export type PropValue = string | number | boolean | null | PropValue[] | { [k: string]: PropValue };

export interface FrontmatterRead {
  props: Record<string, PropValue> | null;
  error: string | null;
  range: { from: number; to: number } | null;
}

export class FrontmatterError extends Error {
  constructor(
    public code: "INVALID_YAML" | "NOT_A_MAPPING",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FrontmatterError";
  }
}

const FM_RE = /^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---/;

interface Located {
  from: number;
  to: number;
  yamlStart: number;
  raw: string;
  eol: string;
}

function locate(content: string): Located | null {
  const m = FM_RE.exec(content);
  if (!m) return null;
  const from = (m[1] ?? "").length;
  const raw = m[2] ?? "";
  const eol = content.startsWith("\r\n", from + 3) ? "\r\n" : "\n";
  const yamlStart = from + 3 + eol.length;
  return { from, to: m[0].length, yamlStart, raw, eol };
}

export function toPropValue(v: unknown, depth = 0): PropValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (depth > 12) return null;
  if (Array.isArray(v)) return v.map((x) => toPropValue(x, depth + 1));
  if (v instanceof Map) {
    const out: Record<string, PropValue> = {};
    for (const [k, x] of v) if (String(k) !== "__proto__") out[String(k)] = toPropValue(x, depth + 1);
    return out;
  }
  if (typeof v === "object") {
    const out: Record<string, PropValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k !== "__proto__") out[k] = toPropValue(x, depth + 1);
    }
    return out;
  }
  return String(v);
}

function parseBlock(raw: string): Document.Parsed {
  return parseDocument(raw, { keepSourceTokens: true });
}

type Parsed = { props: Record<string, PropValue>; map: YAMLMap | null } | { props: null; error: string; code: FrontmatterError["code"] };

function parseProps(raw: string): Parsed {
  const doc = parseBlock(raw);
  if (doc.errors.length > 0) return { props: null, error: doc.errors[0]!.message, code: "INVALID_YAML" };
  if (doc.contents === null) return { props: {}, map: null };
  if (!isMap(doc.contents)) return { props: null, error: "frontmatter must be YAML mapping", code: "NOT_A_MAPPING" };
  // parseDocument does not report an unresolved alias or an alias bomb;
  // toJS throws on them instead.
  try {
    return { props: toPropValue(doc.toJS()) as Record<string, PropValue>, map: doc.contents };
  } catch (e) {
    return { props: null, error: e instanceof Error ? e.message : String(e), code: "INVALID_YAML" };
  }
}

export function readFrontmatter(content: string): FrontmatterRead {
  const loc = locate(content);
  if (!loc) return { props: null, error: null, range: null };
  const range = { from: loc.from, to: loc.to };
  const p = parseProps(loc.raw);
  if (p.props === null) return { props: null, error: p.error, range };
  return { props: p.props, error: null, range };
}

function renderInlineScalar(v: string | number | boolean | null): string {
  if (typeof v === "string") {
    if (v.includes("\n") || v.startsWith("[[")) return JSON.stringify(v);
    return stringify(v, { lineWidth: 0 }).trimEnd();
  }
  if (v === null) return "null";
  return String(v);
}

function isScalarValue(v: PropValue): v is string | number | boolean | null {
  return v === null || typeof v !== "object";
}

function renderFlowItem(x: PropValue): string {
  if (!isScalarValue(x) || (typeof x === "string" && /[,[\]{}]/.test(x))) return JSON.stringify(x);
  return renderInlineScalar(x);
}

function renderFlow(v: PropValue[]): string {
  return `[${v.map(renderFlowItem).join(", ")}]`;
}

// A non-scalar value as block lines, each prefixed with `indent`.
function renderBlock(v: PropValue, indent: string, eol: string): string {
  if (Array.isArray(v) && v.length === 0) return "[]";
  if (!Array.isArray(v) && typeof v === "object" && v !== null && Object.keys(v).length === 0) return "{}";
  const lines: string[] = [];
  if (Array.isArray(v) && v.every(isScalarValue)) {
    for (const x of v) lines.push(`- ${renderInlineScalar(x as string | number | boolean | null)}`);
  } else {
    lines.push(...stringify(v, { indent: 2, lineWidth: 0 }).trimEnd().split("\n"));
  }
  return lines.map((l) => indent + l).join(eol);
}

function detectIndent(raw: string): string {
  const m = /^( +)\S/m.exec(raw);
  return m ? m[1]! : "  ";
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function lineStartOf(raw: string, pos: number): number {
  return raw.lastIndexOf("\n", pos - 1) + 1;
}

function endOfLine(raw: string, pos: number): number {
  if (pos >= raw.length || raw[pos - 1] === "\n") return Math.min(pos, raw.length);
  const nl = raw.indexOf("\n", pos);
  return nl < 0 ? raw.length : nl + 1;
}

function keyName(p: Pair): string | null {
  return isScalar(p.key) ? String(p.key.value) : null;
}

function findPair(map: YAMLMap, name: string): { pair: Pair; index: number } | null {
  const items = map.items as Pair[];
  for (let i = 0; i < items.length; i++) {
    if (keyName(items[i]!) === name) return { pair: items[i]!, index: i };
  }
  return null;
}

function keyRange(p: Pair): [number, number, number] {
  return (p.key as { range: [number, number, number] }).range;
}

const BREAKS = "edit would break the frontmatter; edit in source";

function openBlock(loc: Located): { props: Record<string, PropValue>; map: YAMLMap | null } {
  const p = parseProps(loc.raw);
  if (p.props === null) throw new FrontmatterError(p.code, p.error);
  return p;
}

// The spliced block must parse to exactly `expected`: an anchor, an alias or
// odd layout can make a textual edit change keys it never touched.
function verified(loc: Located, content: string, nextRaw: string, expected: Record<string, PropValue>): string {
  const p = parseProps(nextRaw);
  if (p.props === null) throw new FrontmatterError("INVALID_YAML", BREAKS);
  const keys = new Set([...Object.keys(expected), ...Object.keys(p.props)]);
  for (const k of keys) {
    const same = Object.hasOwn(expected, k) && Object.hasOwn(p.props, k) && JSON.stringify(p.props[k]) === JSON.stringify(expected[k]);
    if (!same) throw new FrontmatterError("INVALID_YAML", BREAKS);
  }
  return content.slice(0, loc.yamlStart) + nextRaw + content.slice(loc.yamlStart + loc.raw.length);
}

function applyEdits(raw: string, edits: Edit[]): string {
  let out = raw;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

function replaceValue(raw: string, pair: Pair, value: PropValue, eol: string, indentUnit: string): Edit {
  const kr = keyRange(pair);
  const node = pair.value as { range?: [number, number, number]; flow?: boolean; type?: string } | null;
  const afterColon = raw.indexOf(":", kr[1]) + 1;
  const nonScalar = !isScalarValue(value);

  if (!node || !node.range || node.range[0] === node.range[1]) {
    const gap = /^[ \t]*/.exec(raw.slice(afterColon))![0].length;
    if (value === null) return { start: afterColon, end: afterColon + gap, text: "" };
    const body = nonScalar && !(Array.isArray(value) && value.length === 0)
      ? `${eol}${renderBlock(value, indentUnit, eol)}`
      : ` ${nonScalar ? renderBlock(value, "", eol) : renderInlineScalar(value)}`;
    return { start: afterColon, end: afterColon + gap, text: body };
  }

  const [vStart, vEnd] = node.range;
  const isBlockSeq = isSeq(pair.value) && !node.flow;
  const isBlockMap = isMap(pair.value) && !node.flow;
  const isBlockScalar = isScalar(pair.value) && (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED");
  const oldBlock = isBlockSeq || isBlockMap || isBlockScalar;
  const oldText = raw.slice(vStart, vEnd);
  const trailingEol = oldText.endsWith("\n") ? eol : "";

  if (value === null) return { start: afterColon, end: vEnd, text: trailingEol };

  if (isBlockSeq && Array.isArray(value) && value.length > 0 && value.every(isScalarValue)) {
    const indent = raw.slice(lineStartOf(raw, vStart), vStart);
    const items = value.map((x, i) => `${i === 0 ? "" : indent}- ${renderInlineScalar(x as string | number | boolean | null)}`);
    return { start: vStart, end: vEnd, text: items.join(eol) + trailingEol };
  }
  if (isSeq(pair.value) && node.flow && Array.isArray(value) && value.every(isScalarValue)) {
    return { start: vStart, end: vEnd, text: renderFlow(value) };
  }
  if (!nonScalar || (Array.isArray(value) && value.length === 0) || (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)) {
    const inline = nonScalar ? renderBlock(value, "", eol) : renderInlineScalar(value);
    if (oldBlock) return { start: afterColon, end: vEnd, text: ` ${inline}${trailingEol}` };
    return { start: vStart, end: vEnd, text: inline };
  }
  const block = `${eol}${renderBlock(value, indentUnit, eol)}`;
  return { start: afterColon, end: vEnd, text: block + trailingEol };
}

function deletePairEdit(raw: string, map: YAMLMap, index: number): Edit {
  const pair = (map.items as Pair[])[index]!;
  const v = pair.value as { range?: [number, number, number] } | null;
  const tail = v?.range ? v.range[1] : keyRange(pair)[1];
  return { start: lineStartOf(raw, keyRange(pair)[0]), end: endOfLine(raw, tail), text: "" };
}

function newBlock(content: string, set: Record<string, PropValue>): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const rest = bom ? content.slice(1) : content;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(set)) lines.push(...appendLines(k, v, "  ", eol));
  return `${bom}---${eol}${lines.join(eol)}${eol}---${eol}${rest}`;
}

function appendLines(key: string, v: PropValue, indent: string, eol: string): string[] {
  const k = renderInlineScalar(key);
  if (v === null) return [`${k}:`];
  if (isScalarValue(v)) return [`${k}: ${renderInlineScalar(v)}`];
  const b = renderBlock(v, indent, eol);
  return b === "[]" || b === "{}" ? [`${k}: ${b}`] : [`${k}:`, ...b.split(eol)];
}

export function setProperties(content: string, set: Record<string, PropValue>, unset: string[] = []): string {
  const loc = locate(content);
  const setKeys = Object.keys(set);
  if (!loc) return setKeys.length === 0 ? content : newBlock(content, set);
  const { props, map } = openBlock(loc);
  // Set and unset splice block-style lines; inside `{a: 1, b: 2}` they would
  // drop or corrupt the other keys.
  if (map?.flow) throw new FrontmatterError("INVALID_YAML", "frontmatter is a flow mapping; edit in source");
  const indentUnit = detectIndent(loc.raw);
  const edits: Edit[] = [];
  const appended: string[] = [];
  let deleted = false;

  for (const name of unset) {
    if (Object.hasOwn(set, name)) continue;
    const hit = map ? findPair(map, name) : null;
    if (hit && map) {
      edits.push(deletePairEdit(loc.raw, map, hit.index));
      deleted = true;
    }
  }
  for (const [name, value] of Object.entries(set)) {
    const hit = map ? findPair(map, name) : null;
    if (hit) edits.push(replaceValue(loc.raw, hit.pair, value, loc.eol, indentUnit));
    else appended.push(...appendLines(name, value, indentUnit, loc.eol));
  }
  if (edits.length === 0 && appended.length === 0) return content;
  let nextRaw = applyEdits(loc.raw, edits);
  if (deleted && nextRaw.endsWith(loc.eol) && !loc.raw.endsWith("\n")) {
    nextRaw = nextRaw.slice(0, -loc.eol.length);
  }
  if (appended.length > 0) nextRaw += (nextRaw === "" ? "" : loc.eol) + appended.join(loc.eol);
  const expected: Record<string, PropValue> = Object.create(null);
  for (const [k, v] of Object.entries(props)) if (!unset.includes(k)) expected[k] = v;
  for (const [k, v] of Object.entries(set)) expected[k] = toPropValue(v);
  return verified(loc, content, nextRaw, expected);
}

export function renameProperty(content: string, from: string, to: string): string {
  const loc = locate(content);
  if (!loc || from === to) return content;
  const { props, map } = openBlock(loc);
  if (!map) return content;
  const hit = findPair(map, from);
  if (!hit || findPair(map, to)) return content;
  const [ks, ke] = keyRange(hit.pair);
  const nextRaw = loc.raw.slice(0, ks) + renderInlineScalar(to) + loc.raw.slice(ke);
  const expected: Record<string, PropValue> = Object.create(null);
  for (const [k, v] of Object.entries(props)) expected[k === from ? to : k] = v;
  return verified(loc, content, nextRaw, expected);
}
