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
