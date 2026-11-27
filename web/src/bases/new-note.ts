import { stringify } from "yaml";
import type { FilterNode } from "@brainmd/shared/base-types";
import type { PropValue } from "@brainmd/shared/frontmatter";

export interface NewNotePlan {
  folder: string;
  props: Record<string, PropValue>;
}

const STR = `(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`;
const RE_FOLDER = new RegExp(`^file\\.inFolder\\(\\s*${STR}\\s*\\)$`);
const RE_FOLDER_EQ = new RegExp(`^file\\.folder\\s*==\\s*${STR}$`);
const RE_TAG = new RegExp(`^file\\.hasTag\\(\\s*${STR}\\s*\\)$`);
const RE_EQ = new RegExp(`^(?:note\\.)?([\\p{L}_][\\p{L}\\p{N}_]*)\\s*==\\s*(.+)$`, "u");
const RE_EQ_BRACKET = new RegExp(`^note\\[\\s*${STR}\\s*\\]\\s*==\\s*(.+)$`);

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", '"': '"', "'": "'", "\\": "\\" };
const unesc = (s: string): string => s.replace(/\\(.)/g, (all, c: string) => ESCAPES[c] ?? all);
const unq = (m: RegExpExecArray, i = 1): string => unesc(m[i] ?? m[i + 1] ?? "");

function literal(src: string): PropValue | undefined {
  const t = src.trim();
  const s = new RegExp(`^${STR}$`).exec(t);
  if (s) return unesc(s[1] ?? s[2] ?? "");
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    if (t === "-0") return t;
    const n = Number(t);
    if (!/\./.test(t) && !Number.isSafeInteger(n)) return t;
    return Number.isFinite(n) ? n : t;
  }
  return undefined;
}

function leaves(f: FilterNode | undefined, out: string[]): void {
  if (f === undefined) return;
  if (typeof f === "string") out.push(f.trim());
  else if ("and" in f) for (const k of f.and) leaves(k, out);
}

// The note a "+ New" button creates: the folder an inFolder / folder filter
// names and the properties that plain equality and hasTag filters imply.
// Filters under or / not say nothing definite, so they are skipped.
export function planNewNote(filters: Array<FilterNode | undefined>, preset: Record<string, PropValue> = {}): NewNotePlan {
  const list: string[] = [];
  for (const f of filters) leaves(f, list);
  let folder = "";
  const props: Record<string, PropValue> = {};
  const tags: string[] = [];
  for (const l of list) {
    let m = RE_FOLDER.exec(l) ?? RE_FOLDER_EQ.exec(l);
    if (m) {
      if (folder === "") folder = unq(m).replace(/^\/+|\/+$/g, "");
      continue;
    }
    m = RE_TAG.exec(l);
    if (m) {
      const tag = unq(m).trim().replace(/^#/, "").trim();
      if (tag !== "") tags.push(tag);
      continue;
    }
    const b = RE_EQ_BRACKET.exec(l);
    const e = b ?? RE_EQ.exec(l);
    if (e) {
      const name = b ? unq(b) : e[1]!;
      const v = literal(b ? (b[3] ?? "") : e[2]!);
      if (v !== undefined && !["file", "formula", "this", "note"].includes(name)) props[name] = v;
    }
  }
  if (tags.length > 0) {
    const had = Array.isArray(props.tags) ? (props.tags as string[]) : typeof props.tags === "string" ? [props.tags] : [];
    props.tags = [...new Set([...had, ...tags])];
  }
  return { folder, props: { ...props, ...preset } };
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeFileName(title: string): string {
  let n = title
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 100)
    .replace(/[. ]+$/, "")
    .trim();
  if (n === "") return "Untitled";
  if (RESERVED.test(n.split(".")[0]!)) n = `${n}_`;
  return n;
}

function safeFolder(folder: string): string {
  return folder
    .split(/[/\\]+/)
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .join("/");
}

// `exists` must be backed by the vault index, which is case-insensitive about
// paths on some filesystems, so a candidate also collides when its lower-cased
// form exists.
export function uniqueNotePath(folder: string, exists: (path: string) => boolean, base = "Untitled"): string {
  const f = safeFolder(folder);
  const dir = f ? `${f}/` : "";
  const name = safeFileName(base);
  const taken = (p: string): boolean => exists(p) || exists(p.toLowerCase());
  for (let i = 0; i < 1000; i++) {
    const p = `${dir}${name}${i === 0 ? "" : ` ${i}`}.md`;
    if (!taken(p)) return p;
  }
  const stamp = Date.now();
  for (let i = 0; i < 1000; i++) {
    const p = `${dir}${name} ${stamp}${i === 0 ? "" : `-${i}`}.md`;
    if (!taken(p)) return p;
  }
  throw new Error("no free note name");
}

export function buildNoteContent(title: string, props: Record<string, PropValue>): string {
  const fm = Object.keys(props).length > 0 ? `---\n${stringify(props, { lineWidth: 0 }).trimEnd()}\n---\n\n` : "";
  return `${fm}# ${title.replace(/[\r\n]+/g, " ").trim()}\n\n`;
}
