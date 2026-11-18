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

// The part of `g` within `depth` hops of `center`.
export function neighbourhood(g: VaultGraph, center: string, depth: number): VaultGraph {
  const adj = new Map<string, string[]>();
  for (const l of g.links) {
    const a = adj.get(l.source) ?? [];
    a.push(l.target);
    adj.set(l.source, a);
    const b = adj.get(l.target) ?? [];
    b.push(l.source);
    adj.set(l.target, b);
  }
  const keep = new Set([center]);
  let frontier = [center];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const m of adj.get(id) ?? []) {
        if (keep.has(m)) continue;
        keep.add(m);
        next.push(m);
      }
    }
    frontier = next;
  }
  return {
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    links: g.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
  };
}

// A few lines a model can use on its own: counts, the best-linked notes and
// how many notes have no links.
export function graphSummary(g: VaultGraph, scope: string): string {
  const degree = new Map<string, number>();
  for (const l of g.links) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1);
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1);
  }
  const hubs = [...degree.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([id, d]) => `${id} (${d})`);
  const unlinked = g.nodes.filter((n) => !degree.has(n.id)).length;
  return [
    `Graph of ${scope}: ${g.nodes.length} notes, ${g.links.length} links, ${unlinked} without links.`,
    hubs.length ? `Most linked: ${hubs.join(", ")}.` : "No links.",
  ].join("\n");
}
