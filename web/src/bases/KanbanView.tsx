import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlusIcon } from "@radix-ui/react-icons";
import { setViewGroupBy } from "@brainmd/shared/base-yaml";
import type { PropValue } from "@brainmd/shared/frontmatter";
import { DropdownMenuItem } from "../components/ui/dropdown-menu";
import { CellValue } from "./CellValue";
import { RowMenu } from "./RowMenu";
import type { BaseHost } from "./host";
import { MAX_MOVE_KEY, boardColumns, columnAt, dragStarted, groupType as groupTypeOf, moveChange, moveRefusal, moveRowInResult, presetValue, propNameOf } from "./model";
import type { Column, LayoutProps, Row } from "./types";

type ColumnInfo = { key: string | null; label: string };

interface DragState {
  path: string;
  title: string;
  x: number;
  y: number;
  over: { key: string | null } | undefined;
}

const NO_KEY = "\u0000none";

// Follows the pointer through a ref, so a move does not re-render the board.
function Ghost({ title, x, y, elRef }: { title: string; x: number; y: number; elRef: React.MutableRefObject<HTMLDivElement | null> }) {
  return (
    <div ref={elRef} className="base-ghost" style={{ left: 0, top: 0, transform: `translate(${x + 8}px, ${y + 8}px)` }} aria-hidden>
      {title}
    </div>
  );
}

interface CardProps {
  row: Row;
  lifted: boolean;
  menuColumns: ColumnInfo[];
  why: string | null;
  cols: Column[];
  host: BaseHost;
  onPointerDown(e: ReactPointerEvent<HTMLElement>, row: Row): void;
  onMove(row: Row, toKey: string | null): void;
}

const Card = memo(function Card({ row, lifted, menuColumns, why, cols, host, onPointerDown, onMove }: CardProps) {
  return (
    <article className={lifted ? "base-card lifted" : "base-card"} data-card-path={row.path} onPointerDown={(e) => onPointerDown(e, row)}>
      <div className="base-card-head">
        <button type="button" className="base-link base-card-title" onClick={() => host.openNote(row.path)}>
          {row.title || row.path}
        </button>
        <RowMenu row={row} host={host}>
          {why ? (
            <DropdownMenuItem disabled>{why}</DropdownMenuItem>
          ) : menuColumns.length > 0
            ? menuColumns.map((c) => (
                <DropdownMenuItem key={c.key ?? NO_KEY} onSelect={() => onMove(row, c.key)}>
                  Move to {c.label}
                </DropdownMenuItem>
              ))
            : null}
        </RowMenu>
      </div>
      <dl className="base-card-props">
        {cols.map((c) => {
          const v = row.values[c.key] ?? null;
          if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
          return (
            <div key={c.key}>
              <dt>{c.label}</dt>
              <dd>
                <CellValue col={c} value={v} row={row} host={host} />
              </dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
});

export function KanbanView(props: LayoutProps) {
  const { result, view, host, vaultTypes, editView } = props;
  const [drag, setDrag] = useState<DragState | null>(null);
  const colRefs = useRef(new Map<string | null, HTMLElement>());
  const boardRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<() => void>(() => {});
  const focusPath = useRef<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  useEffect(() => () => cleanupRef.current(), []);

  const groupKey = view.groupBy?.property ?? null;
  const groupProp = groupKey ? propNameOf(groupKey) : null;
  const groupType = groupKey ? groupTypeOf(groupKey, vaultTypes, result) : undefined;

  const columns = useMemo(() => boardColumns(result.groups), [result.groups]);
  const menuFor = useMemo(() => new Map(columns.map((g) => [g.key, columns.filter((c) => c.key !== g.key).map(({ key, label }) => ({ key, label }))])), [columns]);
  const cols = useMemo(() => result.columns.filter((c) => c.key !== "file.name"), [result.columns]);

  const refusal = (row: Row, toKey?: string | null) => (groupKey ? moveRefusal(groupKey, groupType, row, toKey) : null);

  const moveTo = useCallback((row: Row, toKey: string | null) => {
    const { result: res, view: v, vaultTypes: types, host: h, saveProps } = latest.current;
    const gk = v.groupBy?.property;
    const prop = gk ? propNameOf(gk) : null;
    if (!gk) return;
    const from = res.groups.find((g) => g.rows.some((r) => r.path === row.path))?.key ?? null;
    if (from === toKey) return;
    const type = groupTypeOf(gk, types, res);
    const why = moveRefusal(gk, type, row, toKey);
    const ch = why || !prop ? null : moveChange(type, toKey);
    if (!ch || !prop) {
      h.toast(why ?? "This board is grouped by a list property, so cards cannot move");
      return;
    }
    void saveProps(row, "set" in ch ? { set: { [prop]: ch.set } } : { unset: [prop] }, (r) => moveRowInResult(r, row.path, toKey));
  }, []);

  const moveFromMenu = useCallback(
    (row: Row, toKey: string | null) => {
      focusPath.current = row.path;
      moveTo(row, toKey);
    },
    [moveTo],
  );

  useEffect(() => {
    const path = focusPath.current;
    if (!path) return;
    focusPath.current = null;
    const t = setTimeout(() => {
      const card = [...(boardRef.current?.querySelectorAll<HTMLElement>("[data-card-path]") ?? [])].find((el) => el.dataset.cardPath === path);
      card?.querySelector<HTMLElement>(".base-card-title")?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [result]);

  const onCardPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>, row: Row) => {
    const target = e.target as HTMLElement;
    if (e.pointerType !== "mouse" || e.button !== 0 || (target.closest("button, a, input, select") && !target.closest(".base-card-title"))) return;
    const cur = latest.current;
    const gk = cur.view.groupBy?.property;
    if (!gk) return;
    const why = moveRefusal(gk, groupTypeOf(gk, cur.vaultTypes, cur.result), row);
    cleanupRef.current();
    const card = e.currentTarget;
    const id = e.pointerId;
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
        boardRef.current?.getBoundingClientRect(),
      );
    // The title is a button: without this the release would also open the note.
    const swallowClick = () => {
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, true), 50);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      try {
        card.releasePointerCapture(id);
      } catch {
        /* already released */
      }
      cleanupRef.current = () => {};
    };
    const abort = () => {
      cleanup();
      if (dragging) swallowClick();
      setDrag(null);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      lx = ev.clientX;
      ly = ev.clientY;
      if (!dragging) {
        if (!dragStarted(lx - x0, ly - y0)) return;
        if (why) {
          cleanup();
          swallowClick();
          latest.current.host.toast(why);
          return;
        }
        dragging = true;
        try {
          card.setPointerCapture(id);
        } catch {
          /* capture is only a nicety */
        }
        setDrag({ path: row.path, title: row.title || row.path, x: lx, y: ly, over: hit(lx, ly) });
        return;
      }
      if (ghostRef.current) ghostRef.current.style.transform = `translate(${lx + 8}px, ${ly + 8}px)`;
      const over = hit(lx, ly);
      setDrag((d) => (d && d.over?.key === over?.key && !!d.over === !!over ? d : d && { ...d, over }));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const dropOn = dragging ? hit(lx, ly) : undefined;
      abort();
      if (dropOn) moveTo(row, dropOn.key);
    };
    const cancel = (ev: Event) => {
      if (ev instanceof PointerEvent && ev.pointerId !== id) return;
      abort();
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      abort();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    cleanupRef.current = cleanup;
  }, [moveTo]);

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

  // { why }: the column cannot take a preset, with the reason.
  const presetFor = (key: string | null): { preset: Record<string, PropValue> } | { why: string } => {
    if (!groupProp) return { why: "Grouped by a computed property, so a new note cannot be preset" };
    if (key !== null && key.length >= MAX_MOVE_KEY) return { why: "This column name is too long to preset on a new note" };
    const ch = presetValue(groupType, key);
    if (!ch) return { why: "This column is a joined list value, so a new note cannot be preset" };
    return { preset: "set" in ch ? { [groupProp]: ch.set } : {} };
  };

  return (
    <div ref={boardRef} className={drag ? "base-board dragging" : "base-board"}>
      {columns.map((g) => {
        const plus = presetFor(g.key);
        return (
          <section
            key={g.key ?? NO_KEY}
            className={drag?.over && drag.over.key === g.key ? "base-col over" : "base-col"}
            data-empty={g.rows.length === 0 ? "" : undefined}
            ref={(el) => {
              if (el) colRefs.current.set(g.key, el);
              else colRefs.current.delete(g.key);
            }}
            aria-label={`${g.label}, ${g.count} notes`}
          >
            <header className="base-col-head">
              <h4>{g.label}</h4>
              <span className="base-count">{g.count}</span>
              <button
                type="button"
                className="btn base-btn icon"
                aria-label={"why" in plus ? `Add a note to ${g.label} (unavailable)` : `Add a note to ${g.label}`}
                disabled={"why" in plus}
                title={"why" in plus ? plus.why : undefined}
                onClick={() => "preset" in plus && void props.newNote(plus.preset)}
              >
                <PlusIcon aria-hidden />
                {"why" in plus ? <span className="sr-only">{plus.why}</span> : null}
              </button>
            </header>
            <div className="base-col-body">
              {g.rows.map((r) => (
                <Card
                  key={r.path}
                  row={r}
                  lifted={drag?.path === r.path}
                  menuColumns={refusal(r) === null ? (menuFor.get(g.key) ?? EMPTY) : EMPTY}
                  why={refusal(r)}
                  cols={cols}
                  host={host}
                  onPointerDown={onCardPointerDown}
                  onMove={moveFromMenu}
                />
              ))}
            </div>
          </section>
        );
      })}
      {drag ? <Ghost title={drag.title} x={drag.x} y={drag.y} elRef={ghostRef} /> : null}
    </div>
  );
}

const EMPTY: ColumnInfo[] = [];
