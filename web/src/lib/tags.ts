import { parse as parseYaml } from "yaml";

// Match server's inline tag rule: # followed by 1+ tag chars.
// Allowed chars: A-Z a-z 0-9 / - _. First char must not be a digit alone
// (e.g. "#123" is not a tag — see Obsidian rule).
const TAG_RE = /(^|[^\w/])#([A-Za-z][\w/-]*)/g;

function parseFrontmatterTags(content: string): string[] {
  if (!content.startsWith("---")) return [];
  const end = content.indexOf("\n---", 3);
  if (end < 0) return [];
  const yaml = content.slice(3, end).trim();
  let data: unknown;
  try {
    data = parseYaml(yaml);
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const out: string[] = [];
  const fm = data as Record<string, unknown>;
  for (const key of ["tags", "tag"]) {
    const v = fm[key];
    if (Array.isArray(v)) {
      for (const t of v) {
        if (typeof t === "string") out.push(t.replace(/^#/, ""));
      }
    } else if (typeof v === "string") {
      for (const t of v.split(/[,\s]+/)) {
        if (t) out.push(t.replace(/^#/, ""));
      }
    }
  }
  return out;
}

function parseInlineTags(content: string): string[] {
  // Strip code fences and frontmatter to avoid false positives.
  const body = content
    .replace(/^---[\s\S]*?\n---\n?/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(body)) !== null) {
    if (m[2]) out.push(m[2]);
  }
  return out;
}

export function extractTagsFromMd(content: string): Set<string> {
  const fm = parseFrontmatterTags(content);
  const inline = parseInlineTags(content);
  return new Set([...fm, ...inline].map((t) => t.toLowerCase()));
}

// V54 / T137: append a tag to the YAML frontmatter `tags` list, creating
// the frontmatter block (or the list) if missing. Idempotent — never
// double-inserts. Format chosen: inline JSON array (`tags: [a, b]`) so
// the diff stays on one line and survives most YAML parsers.
export function insertFrontmatterTag(content: string, tag: string): string {
  const clean = tag.replace(/^#/, "").trim();
  if (!clean) return content;

  // Already present (frontmatter OR inline) → no-op.
  if (extractTagsFromMd(content).has(clean.toLowerCase())) return content;

  // No frontmatter at all → prepend a minimal one.
  if (!content.startsWith("---")) {
    return `---\ntags: [${clean}]\n---\n\n${content}`;
  }
  const end = content.indexOf("\n---", 3);
  if (end < 0) {
    return `---\ntags: [${clean}]\n---\n\n${content}`;
  }
  const fmBlock = content.slice(0, end); // "---\n…"
  const rest = content.slice(end); // "\n---…"

  // Has a tags: line already? Append to the list.
  const tagsLineRe = /(^|\n)tags:\s*\[([^\]]*)\]/;
  const m = tagsLineRe.exec(fmBlock);
  if (m) {
    const existing = (m[2] ?? "").trim();
    const next = existing
      ? `${m[1] ?? ""}tags: [${existing}, ${clean}]`
      : `${m[1] ?? ""}tags: [${clean}]`;
    return fmBlock.replace(tagsLineRe, next) + rest;
  }
  // Tags as YAML list (multi-line) — insert a list item below it.
  const listRe = /(^|\n)tags:\s*\n((?:\s*-\s*.+\n?)*)/;
  const lm = listRe.exec(fmBlock);
  if (lm) {
    const block = lm[0]!;
    const indented = `${block}  - ${clean}\n`;
    return fmBlock.replace(block, indented) + rest;
  }
  // No tags key → add one before closing ---.
  return `${fmBlock}\ntags: [${clean}]${rest}`;
}
