import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { renderMarkdown } from "../src/renderer/render";

const VAULT_DIR = join(import.meta.dir, "../../example/vault");

const opts = {
  resolveWikilink: () => "note.md",
  isMediaTarget: () => false,
  buildMediaUrl: (target: string) => `/api/media-raw/${target}`,
};

function listNotes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listNotes(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

// Rough but sufficient for a coverage diff: html is already our own
// rehype-stringify output, not arbitrary third-party markup.
function tagNames(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9-]*)/g)) out.add(m[1]!.toLowerCase());
  return out;
}

function classNames(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1]!.split(/\s+/)) if (c) out.add(c);
  }
  return out;
}

describe("sanitizer coverage against the example vault", () => {
  const notes = listNotes(VAULT_DIR);
  expect(notes.length).toBeGreaterThan(0);

  for (const file of notes) {
    test(`renders ${file.slice(VAULT_DIR.length + 1)} unchanged by sanitising`, () => {
      const content = readFileSync(file, "utf8");
      const before = renderMarkdown(content, opts, { sanitize: false });
      const after = renderMarkdown(content, opts, { sanitize: true });

      const beforeTags = tagNames(before.html);
      const afterTags = tagNames(after.html);
      const missingTags = [...beforeTags].filter((t) => !afterTags.has(t));

      const beforeClasses = classNames(before.html);
      const afterClasses = classNames(after.html);
      const missingClasses = [...beforeClasses].filter((c) => !afterClasses.has(c));

      expect(missingTags).toEqual([]);
      expect(missingClasses).toEqual([]);
    });
  }
});
