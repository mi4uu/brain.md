import type { Backlink } from "../api/types";

interface Props {
  items: Backlink[];
  onOpen: (path: string) => void;
}

export function Backlinks({ items, onOpen }: Props) {
  if (items.length === 0) {
    return (
      <div className="backlinks">
        <h3>Backlinks</h3>
        <p className="muted">No backlinks yet.</p>
      </div>
    );
  }
  return (
    <div className="backlinks">
      <h3>Backlinks · {items.length}</h3>
      <ul>
        {items.map((b, i) => (
          <li key={`${b.from}:${b.lineNo}:${i}`} onClick={() => onOpen(b.from)}>
            <div className="from">{b.from.replace(/\.md$/, "")}</div>
            <div className="ctx">L{b.lineNo} · {b.context}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
