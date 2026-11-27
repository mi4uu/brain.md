import { useRef, useState } from "react";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { CellValue, isCellEditable } from "./CellValue";
import type { BaseHost } from "./host";
import { coerceInput, editText, propNameOf } from "./model";
import type { Column, PropChange, Row } from "./types";

interface Props {
  col: Column;
  value: PropValue;
  row: Row;
  host: BaseHost;
  onCommit(change: PropChange): void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inputType(type: PropertyType, value: PropValue): string {
  if (type === "number") return "number";
  if (type === "date" && (value === null || (typeof value === "string" && DATE_RE.test(value)))) return "date";
  return "text";
}

export function EditableCell({ col, value, row, host, onCommit }: Props) {
  const name = propNameOf(col.key);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  if (name === null || !isCellEditable(col, value, row)) return <CellValue col={col} value={value} row={row} host={host} />;
  const type = col.type as PropertyType;

  if (type === "checkbox") {
    return (
      <label className="base-check-wrap">
        <input
          type="checkbox"
          className="base-check"
          checked={value === true}
          aria-label={`${col.label}, ${row.title}`}
          onChange={(e) => onCommit({ set: { [name]: e.target.checked } })}
        />
      </label>
    );
  }

  if (!editing) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a button cannot hold the link buttons CellValue renders
      <div
        className="base-cell-edit"
        role="button"
        tabIndex={0}
        aria-label={`Edit ${col.label}, ${row.title}`}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        <CellValue col={col} value={value} row={row} host={host} />
      </div>
    );
  }

  const finish = (input: HTMLInputElement) => {
    const raw = input.value;
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (input.validity.badInput || editText(value) === raw) return;
    const c = coerceInput(type, raw);
    if (c.kind === "error") host.toast(`${col.label}: ${c.message}`);
    else onCommit(c.kind === "set" ? { set: { [name]: c.value } } : { unset: [name] });
  };

  return (
    <input
      className="base-input base-cell-input"
      type={inputType(type, value)}
      step={type === "number" ? "any" : undefined}
      defaultValue={editText(value)}
      aria-label={`${col.label}, ${row.title}`}
      // biome-ignore lint/a11y/noAutofocus: the input appears because the user just activated the cell
      autoFocus
      spellCheck={false}
      onBlur={(e) => finish(e.target)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
