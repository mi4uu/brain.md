import type { GraphInput } from "./engine";

export interface GraphFilter {
  folder: string | null;
  tag: string | null;
  orphans: boolean;
  query: string;
}

export const DEFAULT_FILTER: GraphFilter = { folder: null, tag: null, orphans: true, query: "" };

// Applies the filters, then drops links whose ends were filtered out.
// Orphans are judged after the folder/tag cut, so a note whose only
// neighbours were hidden counts as unlinked in the filtered view.
export function filterGraph(g: GraphInput, f: GraphFilter): GraphInput {
  const q = f.query.trim().toLowerCase();
  let nodes = g.nodes.filter(
    (n) =>
      (f.folder === null || n.folder === f.folder) &&
      (f.tag === null || n.tags.some((t) => t.toLowerCase() === f.tag?.toLowerCase())) &&
      (q === "" || n.title.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)),
  );
  let ids = new Set(nodes.map((n) => n.id));
  const links = g.links.filter((l) => ids.has(l.source) && ids.has(l.target));
  if (!f.orphans) {
    const linked = new Set(links.flatMap((l) => [l.source, l.target]));
    nodes = nodes.filter((n) => linked.has(n.id));
    ids = new Set(nodes.map((n) => n.id));
  }
  return { nodes, links: links.filter((l) => ids.has(l.source) && ids.has(l.target)) };
}

// The neighbourhood of `center` up to `depth` hops.
export function localGraph(g: GraphInput, center: string, depth: number): GraphInput {
  const adj = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = adj.get(from);
    if (list) list.push(to);
    else adj.set(from, [to]);
  };
  for (const l of g.links) {
    add(l.source, l.target);
    add(l.target, l.source);
  }
  const keep = new Set<string>([center]);
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
