import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlusIcon } from "@radix-ui/react-icons";
import { columnId, setViewGroupBy } from "@brainmd/shared/base-yaml";
import type { PropValue } from "@brainmd/shared/frontmatter";
import { DropdownMenuItem } from "../components/ui/dropdown-menu";
import { CellValue } from "./CellValue";
import { RowMenu } from "./RowMenu";
import { byColumn, canMove, columnAt, dragStarted, moveChange, moveRowInResult, presetValue, propNameOf } from "./model";
import type { LayoutProps, Row } from "./types";

interface DragState {
  row: Row;
  x: number;
  y: number;
  over: { key: string | null } | undefined;
}

const NO_KEY = "\u0000none";

export function KanbanView({ result, view, host, vaultTypes, saveProps, editView, newNote }: LayoutProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const colRefs = useRef(new Map<string | null, HTMLElement>());
  const cleanupRef = useRef<() => void>(() => {});
  useEffect(() => () => cleanupRef.current(), []);

  if (!view.groupBy) {
    const options = result.columns.filter((c) => propNameOf(c.key) !== null).map((c) => c.key);
    const names = [...new Set([...options, ...vaultTypes.keys()])];
    return (
      <div className="base-empty">
        <p>A board needs a property to group by.</p>
        <select
          className="base-select"
          aria-label="Group by"
          value=""
          onChange={(e) => e.target.value && editView((src, i) => setViewGroupBy(src, i, { property: e.target.value, direction: "ASC" }))}
        >
          <option value="">Choose a property…</option>
          {names.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
    );
  }

  const groupKey = view.groupBy.property;
  const groupProp = propNameOf(groupKey);
  const groupType = groupProp ? vaultTypes.get(groupProp) : undefined;

  const columns = result.groups.some((g) => g.key === null) ? result.groups : [...result.groups, { key: null, label: "No value", count: 0, rows: [] }];
  const cards = result.columns.filter((c) => c.key !== "file.name");

  const LIST_MSG = "This board is grouped by a list property, so cards cannot move.";
  // null: the card can move; otherwise the toast that explains why not.
  const refusal = (row: Row): string | null => {
    if (!groupProp) return "This board is grouped by a computed property, so cards cannot move.";
    const value = byColumn(row.values, groupKey) ?? null;
    const partial = row.partial?.some((k) => columnId(k) === columnId(groupKey));
    if (canMove(groupType, value, partial)) return null;
    return partial ? "This note's group value was shortened by the server, so the card cannot move." : LIST_MSG;
  };

  const moveTo = (row: Row, toKey: string | null) => {
    const why = refusal(row);
    const ch = why || !groupProp ? null : moveChange(groupType, toKey);
    if (!ch || !groupProp) {
      host.toast(why ?? LIST_MSG);
      return;
    }
    const from = result.groups.find((g) => g.rows.some((r) => r.path === row.path))?.key ?? null;
    if (from === toKey) return;
    void saveProps(row, "set" in ch ? { set: { [groupProp]: ch.set } } : { unset: [groupProp] }, (r) => moveRowInResult(r, row.path, toKey));
  };

  const presetFor = (key: string | null): Record<string, PropValue> => {
    const ch = groupProp ? presetValue(groupType, key) : null;
    return ch && groupProp && "set" in ch ? { [groupProp]: ch.set } : {};
  };

  const onCardPointerDown = (e: ReactPointerEvent<HTMLElement>, row: Row) => {
    const target = e.target as HTMLElement;
    if (e.pointerType === "touch" || e.button !== 0 || (target.closest("button, a, input, select") && !target.closest(".base-card-title"))) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let lx = x0;
    let ly = y0;
    let dragging = false;
    const hit = (x: number, y: number) =>
      columnAt(
        [...colRefs.current].map(([key, el]) => {
          const r = el.getBoundingClientRect();
          return { key, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
        x,
        y,
      );
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      cleanupRef.current = () => {};
    };
    const move = (ev: PointerEvent) => {
      lx = ev.clientX;
      ly = ev.clientY;
      if (!dragging) {
        if (!dragStarted(lx - x0, ly - y0)) return;
        dragging = true;
      }
      setDrag({ row, x: lx, y: ly, over: hit(lx, ly) });
    };
    const up = () => {
      cleanup();
      const dropOn = dragging ? hit(lx, ly) : undefined;
      setDrag(null);
      if (dragging) {
        // The title is a button: without this the release would also open the note.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, true), 50);
      }
      if (dropOn) moveTo(row, dropOn.key);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      cleanup();
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    cleanupRef.current = cleanup;
  };

  return (
    <div className={drag ? "base-board dragging" : "base-board"}>
      {columns.map((g) => (
        <section
          key={g.key ?? NO_KEY}
          className={drag?.over && drag.over.key === g.key ? "base-col over" : "base-col"}
          ref={(el) => {
            if (el) colRefs.current.set(g.key, el);
            else colRefs.current.delete(g.key);
          }}
          aria-label={`${g.label}, ${g.count} notes`}
        >
          <header className="base-col-head">
            <h4>{g.label}</h4>
            <span className="base-count">{g.count}</span>
            <button type="button" className="btn base-btn icon" aria-label={`Add a note to ${g.label}`} onClick={() => void newNote(presetFor(g.key))}>
              <PlusIcon aria-hidden />
            </button>
          </header>
          <div className="base-col-body">
            {g.rows.map((r) => (
              <article
                key={r.path}
                className={drag?.row.path === r.path ? "base-card lifted" : "base-card"}
                onPointerDown={(e) => onCardPointerDown(e, r)}
              >
                <div className="base-card-head">
                  <button type="button" className="base-link base-card-title" onClick={() => host.openNote(r.path)}>
                    {r.title || r.path}
                  </button>
                  <RowMenu row={r} host={host}>
                    {refusal(r) === null
                      ? columns
                          .filter((c) => c.key !== g.key)
                          .map((c) => (
                            <DropdownMenuItem key={c.key ?? NO_KEY} onSelect={() => moveTo(r, c.key)}>
                              Move to {c.label}
                            </DropdownMenuItem>
                          ))
                      : null}
                  </RowMenu>
                </div>
                <dl className="base-card-props">
                  {cards.map((c) => {
                    const v = r.values[c.key] ?? null;
                    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                    return (
                      <div key={c.key}>
                        <dt>{c.label}</dt>
                        <dd>
                          <CellValue col={c} value={v} row={r} host={host} />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
      {drag ? (
        <div className="base-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }} aria-hidden>
          {drag.row.title || drag.row.path}
        </div>
      ) : null}
    </div>
  );
}
