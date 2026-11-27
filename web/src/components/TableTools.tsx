import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { readTable } from "../tables/apply";
import { escapeCell, setCell, type LineRange, type MdTable } from "../tables/md-table";

export interface CellSel {
  line: number;
  end: number;
  row: number;
  col: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Geo {
  table: Box;
  edit: Box | null;
}

interface TableToolsProps {
  scrollerRef: RefObject<HTMLDivElement | null>;
  docRef: RefObject<HTMLDivElement | null>;
  content: string;
  html: string;
  onEditTable: (range: LineRange, fn: (t: MdTable) => MdTable) => void;
  children: ReactNode;
}

function rectIn(scroller: HTMLElement, el: Element): Box {
  const s = scroller.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return {
    left: r.left - s.left + scroller.scrollLeft,
    top: r.top - s.top + scroller.scrollTop,
    width: r.width,
    height: r.height,
  };
}

function liveTables(doc: HTMLElement): HTMLTableElement[] {
  return Array.from(doc.querySelectorAll<HTMLTableElement>("table[data-source-end]")).filter(
    (t) => !t.closest(".embed-body"),
  );
}

function tableByLine(doc: HTMLElement | null, line: number): HTMLTableElement | null {
  if (!doc) return null;
  return liveTables(doc).find((t) => Number(t.dataset.sourceLine) === line) ?? null;
}

function addressOf(target: EventTarget | null): CellSel | null {
  if (!(target instanceof Element)) return null;
  const cell = target.closest("td, th");
  const table = cell?.closest<HTMLTableElement>("table[data-source-end]");
  if (!cell || !table || table.closest(".embed-body")) return null;
  const tr = cell.parentElement as HTMLTableRowElement | null;
  const line = Number(table.dataset.sourceLine);
  const end = Number(table.dataset.sourceEnd);
  if (!tr || !Number.isInteger(line) || !Number.isInteger(end)) return null;
  const inHead = tr.parentElement?.tagName === "THEAD";
  return { line, end, row: inHead ? -1 : tr.rowIndex - 1, col: (cell as HTMLTableCellElement).cellIndex };
}

function matchesModel(table: HTMLTableElement, model: MdTable): boolean {
  return (
    model.header.length === (table.rows[0]?.cells.length ?? -1) &&
    model.rows.length === table.rows.length - 1
  );
}

const cellText = (m: MdTable, row: number, col: number): string =>
  (row < 0 ? m.header[col] : m.rows[row]?.[col]) ?? "";

export function TableTools({ scrollerRef, docRef, content, html, onEditTable, children }: TableToolsProps) {
  const [editing, setEditing] = useState<CellSel | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [tick, setTick] = useState(0);
  const doneRef = useRef(false);

  // The end line is read from the rendered table at call time: a stored one
  // goes stale as soon as an edit changes the table's line count.
  const liveRange = (line: number): LineRange | null => {
    const table = tableByLine(docRef.current, line);
    const end = Number(table?.dataset.sourceEnd);
    if (!table || !Number.isInteger(end)) return null;
    const range = { from: line, to: end };
    const model = readTable(content, range);
    return model && matchesModel(table, model) ? range : null;
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    const doc = docRef.current;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    if (scroller) ro.observe(scroller);
    if (doc) ro.observe(doc);
    return () => ro.disconnect();
  }, [scrollerRef, docRef]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const doc = docRef.current;
    const table = editing && doc ? tableByLine(doc, editing.line) : null;
    if (!scroller || !table || !editing) {
      setGeo(null);
      if (editing && !table) setEditing(null);
      return;
    }
    const tr = editing.row < 0 ? table.rows[0] : table.rows[editing.row + 1];
    const cell = tr?.cells[editing.col];
    setGeo({ table: rectIn(scroller, table), edit: cell ? rectIn(scroller, cell) : null });
  }, [scrollerRef, docRef, editing, html, tick]);

  useEffect(() => {
    const doc = docRef.current;
    if (!doc) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Element;
      if (t.closest("a, input, button, summary")) return;
      const addr = addressOf(t);
      if (!addr) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      if (!liveRange(addr.line)) return;
      doneRef.current = false;
      setEditing(addr);
    };
    doc.addEventListener("click", onClick);
    return () => doc.removeEventListener("click", onClick);
  }, [docRef, content, html]);

  const model = editing ? readTable(content, { from: editing.line, to: editing.end }) : null;

  const commit = (value: string) => {
    if (!editing || doneRef.current) return;
    doneRef.current = true;
    const target = editing;
    setEditing(null);
    const range = liveRange(target.line);
    const current = range ? readTable(content, range) : null;
    if (!range || !current) return;
    const next = escapeCell(value);
    if (next === cellText(current, target.row, target.col)) return;
    onEditTable(range, (t) => setCell(t, target.row, target.col, next));
  };

  const cancel = () => {
    doneRef.current = true;
    setEditing(null);
  };

  return (
    <>
      {children}
      <div className="table-tools">
        {editing && model && geo?.edit ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: the input opens on a click and must take the keyboard at once
            autoFocus
            className="tt-input"
            aria-label="Edit table cell"
            defaultValue={cellText(model, editing.row, editing.col)}
            style={{ left: geo.edit.left, top: geo.edit.top, width: geo.edit.width, minHeight: geo.edit.height }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={(e) => commit(e.currentTarget.value)}
          />
        ) : null}
      </div>
    </>
  );
}
