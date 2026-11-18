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

// Notes as nodes, resolved wikilinks as undirected edges. Links resolve
// against the whole vault (VaultIndex.resolveLink, the same resolver as
// backlinks), then a target the caller cannot read is dropped exactly like
// an unresolved one. A link never jumps to a different note depending on
// who is looking, at the cost that a hidden note can still win a name tie
// and so remove an edge; its path and content are never shown.
export function buildGraph(index: VaultIndex, allowed: (path: string) => boolean): VaultGraph {
  const entries = index.entries().filter((e) => allowed(e.path));

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
      const target = index.resolveLink(e.path, l.target);
      if (!target || target === e.path || !allowed(target)) continue;
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
