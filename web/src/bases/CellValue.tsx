import type { PropValue } from "@brainmd/shared/frontmatter";
import type { BaseHost } from "./host";
import { formatScalar, isEditable, linkParts } from "./model";
import type { Column, Row } from "./types";

const stripMd = (s: string): string => s.replace(/\.md$/i, "");

interface CellProps {
  col: Column;
  value: PropValue;
  row: Row;
  host: BaseHost;
}

// The one place a view asks whether a cell can be edited: partial cells
// (cut or redacted by the server) are never editable.
export function isCellEditable(col: Column, value: PropValue, row: Row): boolean {
  return isEditable(col.type, col.key, value, row.partial);
}

function Scalar({ col, value, row, host }: CellProps) {
  if (typeof value === "string") {
    const link = linkParts(value);
    if (link) {
      return (
        <button type="button" className="base-link" onClick={(e) => { e.stopPropagation(); host.openLink(link.target, row.path); }}>
          {link.label}
        </button>
      );
    }
  }
  if (typeof value === "boolean") return <input type="checkbox" className="base-check base-check-ro" checked={value} readOnly tabIndex={-1} aria-readonly aria-label={col.label} />;
  return <>{formatScalar(col, value)}</>;
}

function PlainText({ col, value }: CellProps) {
  const text = (v: PropValue): string => (typeof v === "boolean" ? String(v) : formatScalar(col, v));
  return <>{Array.isArray(value) ? value.map(text).join(", ") : text(value)}</>;
}

function Inner(p: CellProps & { plain?: boolean }) {
  const { col, value, row, host, plain } = p;
  if (plain) return <PlainText {...p} />;
  if (col.key === "file.name" && typeof value === "string") {
    return (
      <button type="button" className="base-link" onClick={(e) => { e.stopPropagation(); host.openNote(row.path); }}>
        {stripMd(value)}
      </button>
    );
  }
  if (Array.isArray(value)) {
    return (
      <span className="base-chips">
        {value.map((v, i) => (
          <span className="base-chip" key={i}>
            <Scalar col={col} value={v} row={row} host={host} />
          </span>
        ))}
      </span>
    );
  }
  return <Scalar {...p} />;
}

export function CellValue(p: CellProps) {
  if (!p.row.partial?.includes(p.col.key)) return <Inner {...p} />;
  return (
    <span className="base-partial" data-partial="" title="Shortened or hidden by the server, read-only">
      <Inner {...p} plain />
      <span className="sr-only"> (shortened, read-only)</span>
    </span>
  );
}
