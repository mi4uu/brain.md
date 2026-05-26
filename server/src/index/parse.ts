import { parse as parseYaml } from "yaml";

export interface WikilinkRef {
  target: string;
  alias: string | null;
  embed: boolean;
  lineNo: number;
  context: string;
}

export interface ParsedNote {
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
  title: string;
  body: string;
  tags: string[];
  aliases: string[];
  headings: Array<{ level: number; text: string; line: number }>;
  links: WikilinkRef[];
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(content: string): {
  fm: Record<string, unknown> | null;
  fmError: string | null;
  body: string;
  bodyOffset: number;
} {
  const m = content.match(FM_RE);
  if (!m) return { fm: null, fmError: null, body: content, bodyOffset: 0 };
  const raw = m[1] ?? "";
  let fm: Record<string, unknown> | null = null;
  let fmError: string | null = null;
  try {
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      fm = parsed as Record<string, unknown>;
    } else if (parsed === null) {
      fm = {};
    } else {
      fmError = "frontmatter must be YAML mapping";
    }
  } catch (e) {
    fmError = e instanceof Error ? e.message : String(e);
  }
  const fullLen = m[0].length;
  return { fm, fmError, body: content.slice(fullLen), bodyOffset: fullLen };
}

const WIKILINK_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
const TAG_RE = /(^|[\s.,;:!?(){}\[\]])#([A-Za-z0-9_][A-Za-z0-9_\-\/]*)/g;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_RE = /^([`~]{3,})([^\n]*)$/;
const INLINE_CODE_RE = /`[^`\n]*`/g;

export function parseNote(content: string): ParsedNote {
  const { fm, fmError, body } = splitFrontmatter(content);

  const fmTitle =
    fm && typeof fm.title === "string" ? (fm.title as string).trim() : "";

  const lines = body.split(/\r?\n/);
  const headings: Array<{ level: number; text: string; line: number }> = [];
  const tagsSet = new Set<string>();
  const links: WikilinkRef[] = [];

  let inFence = false;
  let fenceMarker = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trim = line.trim();
    const fence = trim.match(FENCE_RE);
    if (fence) {
      const marker = fence[1] ?? "";
      if (!inFence) {
        inFence = true;
        fenceMarker = marker[0] ?? "`";
      } else if (marker[0] === fenceMarker) {
        inFence = false;
        fenceMarker = "";
      }
      continue;
    }
    if (inFence) continue;

    const h = line.match(HEADING_RE);
    if (h) {
      const hashes = h[1] ?? "";
      const text = (h[2] ?? "").trim();
      headings.push({ level: hashes.length, text, line: i + 1 });
      continue;
    }

    const cleaned = line.replace(INLINE_CODE_RE, (m) => " ".repeat(m.length));

    let lm: RegExpExecArray | null;
    const linkRe = new RegExp(WIKILINK_RE.source, "g");
    while ((lm = linkRe.exec(cleaned)) !== null) {
      const embed = (lm[1] ?? "") === "!";
      const inner = (lm[2] ?? "").trim();
      if (!inner) continue;
      let target = inner;
      let alias: string | null = null;
      const pipe = inner.indexOf("|");
      if (pipe >= 0) {
        target = inner.slice(0, pipe).trim();
        alias = inner.slice(pipe + 1).trim();
      }
      const hashIdx = target.indexOf("#");
      if (hashIdx > 0) target = target.slice(0, hashIdx).trim();
      const caretIdx = target.indexOf("^");
      if (caretIdx > 0) target = target.slice(0, caretIdx).trim();
      links.push({
        target,
        alias,
        embed,
        lineNo: i + 1,
        context: line.trim(),
      });
    }

    const tagRe = new RegExp(TAG_RE.source, "g");
    let tm: RegExpExecArray | null;
    while ((tm = tagRe.exec(cleaned)) !== null) {
      tagsSet.add((tm[2] ?? "").toLowerCase());
    }
  }

  const firstH1 = headings.find((h) => h.level === 1)?.text ?? "";
  const title = fmTitle || firstH1;

  // frontmatter aliases
  const aliases: string[] = [];
  if (fm) {
    const a = fm.aliases ?? fm.alias;
    if (Array.isArray(a)) {
      for (const v of a) if (typeof v === "string" && v.trim() !== "") aliases.push(v.trim());
    } else if (typeof a === "string" && a.trim() !== "") {
      aliases.push(a.trim());
    }
  }

  // frontmatter tags merged with inline
  if (fm) {
    const t = fm.tags ?? fm.tag;
    const push = (v: unknown) => {
      if (typeof v === "string" && v.trim() !== "") {
        tagsSet.add(v.replace(/^#/, "").trim().toLowerCase());
      }
    };
    if (Array.isArray(t)) for (const v of t) push(v);
    else push(t);
  }

  return {
    frontmatter: fm,
    frontmatterError: fmError,
    title,
    body,
    tags: Array.from(tagsSet).sort(),
    aliases,
    headings,
    links,
  };
}
