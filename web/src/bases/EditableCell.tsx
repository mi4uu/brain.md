import { useEffect, useRef, useState } from "react";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { CellValue, isCellEditable } from "./CellValue";
import type { BaseHost } from "./host";
import { cellCommit, cellInputType, editText, propNameOf } from "./model";
import type { Column, PropChange, Row } from "./types";

interface Props {
  col: Column;
  value: PropValue;
  row: Row;
  host: BaseHost;
  onCommit(change: PropChange): Promise<boolean>;
}

interface Editing {
  opened: string;
  draft: string;
}

export function EditableCell({ col, value, row, host, onCommit }: Props) {
  const name = propNameOf(col.key);
  const [editing, setEditing] = useState<Editing | null>(null);
  const cancelled = useRef(false);
  const refocus = useRef(false);
  const cellRef = useRef<HTMLDivElement>(null);
  const initialInput = useRef<string | null>(null);

  useEffect(() => {
    if (editing === null && refocus.current) {
      refocus.current = false;
      cellRef.current?.focus();
    }
  }, [editing]);

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
          onChange={(e) => void onCommit({ set: { [name]: e.target.checked } })}
        />
      </label>
    );
  }

  const open = () => {
    const text = editText(value);
    setEditing({ opened: text, draft: text });
  };

  if (editing === null) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a button cannot hold the link buttons CellValue renders
      <div
        ref={cellRef}
        className="base-cell-edit"
        role="button"
        tabIndex={0}
        aria-label={`Edit ${col.label}, ${row.title}: ${editText(value) || "empty"}`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        <CellValue col={col} value={value} row={row} host={host} />
      </div>
    );
  }

  const finish = (input: HTMLInputElement) => {
    const raw = input.value;
    const opened = editing.opened;
    setEditing(null);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const initial = initialInput.current;
    initialInput.current = null;
    if (input.validity.badInput || raw === initial) return;
    const r = cellCommit({ text: opened }, { value }, raw, type);
    if (r.kind === "error") host.toast(`${col.label}: ${r.message}`);
    else if (r.kind === "conflict") host.toast(`${col.label}: changed meanwhile, not saved`);
    else if (r.kind === "write") {
      void onCommit("set" in r.change ? { set: { [name]: r.change.set } } : { unset: [name] }).then((ok) => {
        const active = document.activeElement;
        if (!ok && (active === null || active === document.body || cellRef.current?.contains(active))) setEditing({ opened, draft: raw });
      });
    }
  };

  return (
    <input
      className="base-input base-cell-input"
      type={cellInputType(type, value)}
      step={type === "number" ? "any" : undefined}
      defaultValue={editing.draft}
      ref={(el) => {
        if (el && initialInput.current === null) initialInput.current = el.value;
      }}
      aria-label={`${col.label}, ${row.title}`}
      // biome-ignore lint/a11y/noAutofocus: the input appears because the user just activated the cell
      autoFocus
      spellCheck={false}
      onBlur={(e) => finish(e.target)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          refocus.current = true;
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancelled.current = true;
          refocus.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
