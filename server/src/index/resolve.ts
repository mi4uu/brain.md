export interface ResolvableEntry {
  path: string;
  basenameLower: string;
  aliases: string[];
}

// No node:path here: web/src/lib/link-resolve.ts is a byte-for-byte copy
// (the web package cannot import server code), and
// server/test/index.link-resolve.test.ts fails if the two drift.
function joinPath(folder: string, rel: string): string | undefined {
  const out = folder ? folder.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return undefined;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

// Wikilink target -> lowercase vault path without ".md", or "" for a link to
// the note itself ([[#Heading]], [[^block]]).
export function normalizeTarget(target: string): string {
  let t = target.trim();
  const cut = t.search(/[#^]/);
  if (cut >= 0) t = t.slice(0, cut);
  return t.trim().replace(/\\/g, "/").replace(/\.md$/i, "").replace(/^\/+/, "").toLowerCase();
}

// Among several notes that share a name, pick the one closest to the
// linking note in the folder tree (steps up plus steps down, so the linking
// note's own folder wins, then a parent's or child's), then the shortest
// path. Ties go to the path that sorts first so the answer never depends on
// index order.
function folderDistance(a: string, b: string): number {
  const x = a ? a.split("/") : [];
  const y = b ? b.split("/") : [];
  let shared = 0;
  while (shared < x.length && shared < y.length && x[shared] === y[shared]) shared++;
  return x.length - shared + (y.length - shared);
}

function pick(candidates: string[] | undefined, fromPath: string): string | undefined {
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  const here = folderOf(fromPath).toLowerCase();
  const dist = new Map(candidates.map((c) => [c, folderDistance(here, folderOf(c).toLowerCase())]));
  return [...candidates].sort(
    (a, b) => (dist.get(a) ?? 0) - (dist.get(b) ?? 0) || a.length - b.length || a.localeCompare(b),
  )[0];
}

// One resolver for backlinks, the graph and MCP Apps, so they always agree
// on where a [[link]] points.
//   1. full vault path:              [[ludzie/kamil]], [[ludzie/kamil.md]]
//   2. path relative to the linker:  [[./kamil]], [[../ludzie/kamil]] (nothing else for these)
//   3. path suffix:                  [[rodzina/marysia]] for private/rodzina/marysia.md
//   4. note name:                    [[kamil]]
//   5. frontmatter alias
// Steps 3 to 5 break ties with pick(): nearest folder, then shortest path.
export class LinkResolver {
  private readonly byPath = new Map<string, string>();
  private readonly byBase = new Map<string, string[]>();
  private readonly byAlias = new Map<string, string[]>();
  // Every trailing run of two or more path segments ("rodzina/marysia" for
  // private/rodzina/marysia.md), so a suffix link is a map lookup.
  private readonly bySuffix = new Map<string, string[]>();

  constructor(entries: Iterable<ResolvableEntry>) {
    for (const e of entries) {
      const key = e.path.replace(/\.md$/i, "").toLowerCase();
      this.byPath.set(key, e.path);
      const segs = key.split("/");
      for (let i = 1; i < segs.length - 1; i++) {
        const suffix = segs.slice(i).join("/");
        const list = this.bySuffix.get(suffix) ?? [];
        list.push(e.path);
        this.bySuffix.set(suffix, list);
      }
      const b = this.byBase.get(e.basenameLower) ?? [];
      b.push(e.path);
      this.byBase.set(e.basenameLower, b);
      for (const a of e.aliases) {
        const k = a.trim().replace(/\.md$/i, "").toLowerCase();
        if (!k) continue;
        const list = this.byAlias.get(k) ?? [];
        if (!list.includes(e.path)) list.push(e.path);
        this.byAlias.set(k, list);
      }
    }
  }

  resolve(fromPath: string, target: string): string | undefined {
    const key = normalizeTarget(target);
    if (!key) return undefined;
    // [[/Index]]: a path from the vault root.
    if (/^\s*\//.test(target)) {
      const rooted = this.byPath.get(key);
      if (rooted) return rooted;
    }
    // [[./x]] and [[../x]] are relative only; one that leaves the vault or
    // finds nothing stays unresolved.
    if (/^\.\.?\//.test(key)) {
      const rel = joinPath(folderOf(fromPath).toLowerCase(), key);
      return rel === undefined ? undefined : this.byPath.get(rel);
    }
    if (key.includes("/")) {
      const exact = this.byPath.get(key);
      if (exact) return exact;
      const rel = joinPath(folderOf(fromPath).toLowerCase(), key);
      const relHit = rel === undefined ? undefined : this.byPath.get(rel);
      if (relHit) return relHit;
      const hit = pick(this.bySuffix.get(key), fromPath);
      if (hit) return hit;
    }
    return pick(this.byBase.get(key), fromPath) ?? pick(this.byAlias.get(key), fromPath);
  }
}
