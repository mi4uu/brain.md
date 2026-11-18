import { useEffect, useMemo, useState } from "react";
import type { GraphInput } from "../graph/engine";
import { localGraph } from "../graph/filter";
import { loadGraph } from "../graph/cache";
import { GraphCanvas } from "./GraphCanvas";

interface Props {
  path: string;
  onOpen: (path: string) => void;
  onExpand: () => void;
}

export function LocalGraph({ path, onOpen, onExpand }: Props) {
  const [graph, setGraph] = useState<GraphInput | null>(null);
  const [depth, setDepth] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadGraph()
      .then((g) => (g.nodes.some((n) => n.id === path) ? g : loadGraph(true)))
      .then((g) => {
        if (live) setGraph(g);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [path]);

  const local = useMemo(() => (graph ? localGraph(graph, path, depth) : null), [graph, path, depth]);
  const folders = useMemo(() => [...new Set(graph?.nodes.map((n) => n.folder) ?? [])], [graph]);

  if (error) return <p className="sidebar-empty">Graph unavailable: {error}</p>;
  return (
    <div className="local-graph">
      <div className="local-graph-bar">
        <span className="muted">{local ? `${Math.max(local.nodes.length - 1, 0)} linked` : "…"}</span>
        <span style={{ flex: 1 }} />
        {[1, 2].map((d) => (
          <button
            key={d}
            type="button"
            className={`local-graph-btn${depth === d ? " active" : ""}`}
            onClick={() => setDepth(d)}
            aria-pressed={depth === d}
          >
            {d === 1 ? "1 hop" : "2 hops"}
          </button>
        ))}
        <button type="button" className="local-graph-btn" onClick={onExpand}>
          Full graph
        </button>
      </div>
      <GraphCanvas data={local} focusId={path} alwaysLabels folders={folders} onOpen={onOpen} className="graph-host graph-host-local" />
    </div>
  );
}
