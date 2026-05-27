import type { RelatedHit } from "../api/client";

interface Props {
  state:
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "disabled" }
    | { kind: "error"; message: string }
    | { kind: "ready"; hits: RelatedHit[] };
  onOpen: (path: string) => void;
}

// V54: thin presentation. Empty / disabled / error states all surface
// a single muted line so the sidebar never looks "broken" just because
// RAG isn't on.
export function Related({ state, onOpen }: Props) {
  if (state.kind === "idle")
    return <p className="sidebar-empty">Open a note to see related ones.</p>;
  if (state.kind === "loading")
    return <p className="sidebar-empty">Finding related notes…</p>;
  if (state.kind === "disabled")
    return (
      <p className="sidebar-empty">
        Enable RAG in Settings to see semantically related notes.
      </p>
    );
  if (state.kind === "error")
    return <p className="sidebar-empty">Related unavailable: {state.message}</p>;
  if (state.hits.length === 0)
    return <p className="sidebar-empty">No related notes found.</p>;
  return (
    <ul className="related-list">
      {state.hits.map((h) => (
        <li
          key={`${h.path}#${h.chunkIndex}`}
          onClick={() => onOpen(h.path)}
          className="related-item"
        >
          <div className="from">{h.path.replace(/\.md$/, "")}</div>
          <div className="ctx">
            {(h.score * 100).toFixed(0)}% · L{h.lineStart}–{h.lineEnd} ·{" "}
            {h.snippet.slice(0, 120)}
            {h.snippet.length > 120 ? "…" : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}
