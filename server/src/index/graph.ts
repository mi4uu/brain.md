import type { VaultIndex } from "./index";

export interface GraphNode {
  id: string;
  title: string;
  folder: string;
  tags: string[];
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface VaultGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}

function stripMd(s: string): string {
  return s.replace(/\.md$/i, "");
}

// Notes as nodes, resolved wikilinks as undirected edges. A link whose
// target the caller cannot read is dropped exactly like an unresolved one,
// so the graph never reveals that a hidden note exists. Lookup maps are
// built once: resolving per link with VaultIndex.resolveAny would scan the
// whole index for every edge.
export function buildGraph(index: VaultIndex, allowed: (path: string) => boolean): VaultGraph {
  const entries = index.entries().filter((e) => allowed(e.path));
  const byPath = new Map<string, string>();
  const byBase = new Map<string, string>();
  const byAlias = new Map<string, string>();
  for (const e of entries) {
    byPath.set(stripMd(e.path).toLowerCase(), e.path);
    if (!byBase.has(e.basenameLower)) byBase.set(e.basenameLower, e.path);
    for (const a of e.aliases) {
      const key = stripMd(a).toLowerCase();
      if (!byAlias.has(key)) byAlias.set(key, e.path);
    }
  }
  const resolve = (targetLower: string): string | undefined => {
    const key = stripMd(targetLower).replace(/^\/+/, "");
    return byPath.get(key) ?? byBase.get(key) ?? byAlias.get(key);
  };

  const nodes: GraphNode[] = entries.map((e) => ({
    id: e.path,
    title: e.title || e.basename,
    folder: e.path.includes("/") ? e.path.slice(0, e.path.indexOf("/")) : "",
    tags: e.tags,
  }));
  const seen = new Set<string>();
  const links: GraphLink[] = [];
  for (const e of entries) {
    for (const l of e.outLinks) {
      const target = resolve(l.targetLower);
      if (!target || target === e.path) continue;
      const key = e.path < target ? `${e.path}\u0000${target}` : `${target}\u0000${e.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: e.path, target });
    }
  }
  return { nodes, links };
}
