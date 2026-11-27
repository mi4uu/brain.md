import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { readTable } from "../tables/apply";
import { escapeCell, setCell, type LineRange, type MdTable } from "../tables/md-table";
import { toast } from "./ui/use-toast";

export interface CellSel {
  line: number;
  row: number;
  col: number;
}

interface Editing extends CellSel {
  text: string;
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
  onEditTable: (range: LineRange, fn: (t: MdTable) => MdTable) => boolean;
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
  if (!tr || !Number.isInteger(line)) return null;
  const inHead = tr.parentElement?.tagName === "THEAD";
  return { line, row: inHead ? -1 : tr.rowIndex - 1, col: (cell as HTMLTableCellElement).cellIndex };
}

function matchesModel(table: HTMLTableElement, model: MdTable): boolean {
  return (
    model.header.length === (table.rows[0]?.cells.length ?? -1) &&
    model.rows.length === table.rows.length - 1
  );
}

const cellText = (m: MdTable, row: number, col: number): string =>
  (row < 0 ? m.header[col] : m.rows[row]?.[col]) ?? "";

const sameCell = (a: CellSel, b: CellSel): boolean => a.line === b.line && a.row === b.row && a.col === b.col;

export function TableTools({ scrollerRef, docRef, content, html, onEditTable, children }: TableToolsProps) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closedRef = useRef<Editing | null>(null);

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

  const close = (target: Editing) => {
    closedRef.current = target;
    setEditing((cur) => (cur === target ? null : cur));
  };

  const commit = (target: Editing, value: string) => {
    if (closedRef.current === target) return;
    close(target);
    const next = escapeCell(value);
    if (next === target.text) return;
    const range = liveRange(target.line);
    if (!range || !onEditTable(range, (t) => setCell(t, target.row, target.col, next))) {
      toast({ description: "Table changed, edit not applied" });
    }
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
    const editable = (t: Element): CellSel | null =>
      t.closest("a, input, button, summary") ? null : addressOf(t);
    // A press on another cell must not blur the open input: the blur commit
    // would re-render the table before mouseup and the click would miss.
    const onMouseDown = (e: MouseEvent) => {
      if (editing && e.button === 0 && editable(e.target as Element)) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const addr = editable(e.target as Element);
      if (!addr) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const range = liveRange(addr.line);
      const model = range ? readTable(content, range) : null;
      if (!model) return;
      e.preventDefault();
      if (editing && sameCell(editing, addr)) return;
      if (editing && inputRef.current) commit(editing, inputRef.current.value);
      setEditing({ ...addr, text: cellText(model, addr.row, addr.col) });
    };
    doc.addEventListener("mousedown", onMouseDown);
    doc.addEventListener("click", onClick);
    return () => {
      doc.removeEventListener("mousedown", onMouseDown);
      doc.removeEventListener("click", onClick);
    };
  });

  return (
    <>
      {children}
      <div className="table-tools">
        {editing && geo?.edit ? (
          <input
            key={`${editing.line}:${editing.row}:${editing.col}`}
            ref={inputRef}
            // biome-ignore lint/a11y/noAutofocus: the input opens on a click and must take the keyboard at once
            autoFocus
            className="tt-input"
            aria-label="Edit table cell"
            defaultValue={editing.text}
            style={{ left: geo.edit.left, top: geo.edit.top, width: geo.edit.width, height: geo.edit.height }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit(editing, e.currentTarget.value);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close(editing);
              }
            }}
            onBlur={(e) => commit(editing, e.currentTarget.value)}
          />
        ) : null}
      </div>
    </>
  );
}
