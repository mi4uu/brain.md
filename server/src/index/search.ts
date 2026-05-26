import type { VaultIndex } from "./index";

export interface SearchHit {
  path: string;
  title: string;
  score: number;
  snippet: string;
  matches: number;
}

const MAX_RESULTS = 50;
const SNIPPET_PAD = 40;

export function search(idx: VaultIndex, q: string): SearchHit[] {
  const query = q.trim();
  if (query === "") return [];
  const qLower = query.toLowerCase();
  const terms = qLower.split(/\s+/).filter(Boolean);
  const hits: SearchHit[] = [];

  for (const e of idx.entries()) {
    let score = 0;
    let matches = 0;
    const titleLower = e.title.toLowerCase();
    const pathLower = e.path.toLowerCase();
    const bodyLower = e.body.toLowerCase();

    for (const t of terms) {
      if (titleLower.includes(t)) {
        score += 10;
        matches += 1;
      }
      if (e.basenameLower.includes(t)) {
        score += 8;
        matches += 1;
      }
      if (pathLower.includes(t)) {
        score += 3;
        matches += 1;
      }
      if (e.tags.some((tag) => tag.includes(t))) {
        score += 5;
        matches += 1;
      }
      let from = 0;
      while (true) {
        const i = bodyLower.indexOf(t, from);
        if (i < 0) break;
        score += 1;
        matches += 1;
        from = i + t.length;
      }
    }

    if (matches === 0) continue;
    hits.push({
      path: e.path,
      title: e.title,
      score,
      snippet: makeSnippet(e.body, terms),
      matches,
    });
  }

  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, MAX_RESULTS);
}

function makeSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  let bestIdx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (bestIdx < 0 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx < 0) return body.slice(0, 120);
  const start = Math.max(0, bestIdx - SNIPPET_PAD);
  const end = Math.min(body.length, bestIdx + SNIPPET_PAD);
  const slice = body.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + slice + (end < body.length ? "…" : "");
}
