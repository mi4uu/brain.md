import { useMemo } from "react";

interface Heading {
  level: number;
  text: string;
  line: number;
  slug: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

export function Outline({ content, onJump }: { content: string; onJump: (line: number, slug: string) => void }) {
  const headings = useMemo<Heading[]>(() => {
    const lines = content.split(/\r?\n/);
    const out: Heading[] = [];
    let inFence = false;
    for (let i = 0; i < lines.length; i++) {
      const trim = (lines[i] ?? "").trim();
      if (trim.startsWith("```") || trim.startsWith("~~~")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = (lines[i] ?? "").match(HEADING_RE);
      if (!m) continue;
      const level = (m[1] ?? "").length;
      const text = (m[2] ?? "").trim();
      out.push({ level, text, line: i + 1, slug: slug(text) });
    }
    return out;
  }, [content]);

  if (headings.length === 0) {
    return null;
  }
  return (
    <div className="outline">
      <h3>Outline</h3>
      {headings.map((h, i) => (
        <a
          key={`${h.line}-${i}`}
          className={`lvl-${h.level}`}
          href={`#${h.slug}`}
          onClick={(e) => {
            e.preventDefault();
            onJump(h.line, h.slug);
          }}
        >
          {h.text}
        </a>
      ))}
    </div>
  );
}
