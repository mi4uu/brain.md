import { useCallback, useEffect, useMemo, useState } from "react";
import type { GraphInput } from "../graph/engine";
import { DEFAULT_FILTER, filterGraph, type GraphFilter } from "../graph/filter";
import { loadGraph, onGraphInvalidated } from "../graph/cache";
import { GraphCanvas } from "./GraphCanvas";

interface Props {
  currentPath: string | null;
  // Resolves once the note is open; the graph closes only then, so a
  // cancelled navigation (unsaved changes) leaves it on screen.
  onOpen: (path: string) => Promise<boolean>;
  onClose: () => void;
}

// Select values cannot be empty for this option, and no folder is named "/".
const ROOT = "/";

export function GraphView({ currentPath, onOpen, onClose }: Props) {
  const [graph, setGraph] = useState<GraphInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GraphFilter>(DEFAULT_FILTER);
  const [legend, setLegend] = useState<Array<{ folder: string; color: string }>>([]);
  const [fit, setFit] = useState(0);

  useEffect(() => {
    const load = () =>
      loadGraph(true)
        .then((g) => {
          setGraph(g);
          setError(null);
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    void load();
    return onGraphInvalidated(() => void load());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) {
        t.blur();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const folders = useMemo(() => [...new Set(graph?.nodes.map((n) => n.folder) ?? [])].sort(), [graph]);
  const tags = useMemo(() => [...new Set(graph?.nodes.flatMap((n) => n.tags) ?? [])].sort(), [graph]);
  const visible = useMemo(() => (graph ? filterGraph(graph, filter) : null), [graph, filter]);
  const onLegend = useCallback((l: Array<{ folder: string; color: string }>) => setLegend(l), []);

  return (
    <div className="graph-overlay" role="dialog" aria-modal="true" aria-label="Graph view">
      <div className="graph-toolbar">
        <strong className="graph-title">Graph</strong>
        <input
          type="search"
          className="graph-input"
          placeholder="Filter notes"
          value={filter.query}
          onChange={(e) => setFilter({ ...filter, query: e.target.value })}
        />
        <select
          className="graph-input"
          aria-label="Folder"
          value={filter.folder === null ? "" : filter.folder === "" ? ROOT : filter.folder}
          onChange={(e) =>
            setFilter({ ...filter, folder: e.target.value === "" ? null : e.target.value === ROOT ? "" : e.target.value })
          }
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f || ROOT} value={f === "" ? ROOT : f}>
              {f === "" ? "(vault root)" : f}
            </option>
          ))}
        </select>
        <select
          className="graph-input"
          aria-label="Tag"
          value={filter.tag ?? ""}
          onChange={(e) => setFilter({ ...filter, tag: e.target.value === "" ? null : e.target.value })}
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <label className="graph-check">
          <input type="checkbox" checked={filter.orphans} onChange={(e) => setFilter({ ...filter, orphans: e.target.checked })} />
          Unlinked notes
        </label>
        <span className="graph-count">
          {visible ? `${visible.nodes.length} notes · ${visible.links.length} links` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn" onClick={() => setFit((n) => n + 1)}>
          Fit
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <p className="muted graph-message">Could not load the graph: {error}</p>
      ) : !graph ? (
        <p className="muted graph-message">Loading graph…</p>
      ) : null}
      <GraphCanvas
        data={visible}
        focusId={currentPath}
        folders={folders}
        onOpen={(id) => {
          void onOpen(id).then((ok) => {
            if (ok) onClose();
          });
        }}
        onLegend={onLegend}
        fitSignal={fit}
        className="graph-host graph-host-full"
      />
      {legend.length > 1 ? (
        <ul className="graph-legend">
          {legend.map((l) => (
            <li key={l.folder}>
              <span className="graph-dot" style={{ background: l.color }} />
              {l.folder === "" ? "(vault root)" : l.folder}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
