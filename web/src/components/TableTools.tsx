import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { readTable } from "../tables/apply";
import { boundaryIndex, moveTarget } from "../tables/drag";
import {
  escapeCell,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  setCell,
  type LineRange,
  type MdTable,
} from "../tables/md-table";
import { PlusIcon } from "./Icons";
import { toast } from "./ui/use-toast";

export interface CellSel {
  line: number;
  row: number;
  col: number;
}

interface Editing extends CellSel {
  text: string;
}

interface TableKey {
  line: number;
}

interface DragState extends TableKey {
  kind: "row" | "col";
  from: number;
  boundary: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Geo {
  table: Box;
  head: Box[];
  body: Box[];
  edit: Box | null;
  limitRight: number;
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
  const coarse = useMediaQuery("(hover: none)");
  const [hover, setHover] = useState<TableKey | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

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

  const edit = (line: number, fn: (t: MdTable) => MdTable) => {
    const range = liveRange(line);
    if (!range || !onEditTable(range, fn)) toast({ description: "Table changed, edit not applied" });
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
    edit(target.line, (t) => setCell(t, target.row, target.col, next));
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    const doc = docRef.current;
    const ro = new ResizeObserver(() => setTick((n) => n + 1));
    if (scroller) ro.observe(scroller);
    if (doc) ro.observe(doc);
    return () => ro.disconnect();
  }, [scrollerRef, docRef]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let timer = 0;
    const clearSoon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setHover(null), 160);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const t = e.target as Element | null;
      if (t?.closest(".table-tools")) {
        window.clearTimeout(timer);
        return;
      }
      const table = t?.closest<HTMLTableElement>("table[data-source-end]");
      if (table && !table.closest(".embed-body")) {
        window.clearTimeout(timer);
        const line = Number(table.dataset.sourceLine);
        setHover((h) => (h && h.line === line ? h : { line }));
        return;
      }
      clearSoon();
    };
    scroller.addEventListener("pointermove", onMove);
    scroller.addEventListener("pointerleave", clearSoon);
    return () => {
      window.clearTimeout(timer);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerleave", clearSoon);
    };
  }, [scrollerRef]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const doc = docRef.current;
    const key: TableKey | null = editing ?? drag ?? (coarse ? null : hover);
    const table = key && doc ? tableByLine(doc, key.line) : null;
    if (!scroller || !table) {
      setGeo(null);
      if (editing && !table) setEditing(null);
      return;
    }
    let editBox: Box | null = null;
    if (editing) {
      const tr = editing.row < 0 ? table.rows[0] : table.rows[editing.row + 1];
      const cell = tr?.cells[editing.col];
      editBox = cell ? rectIn(scroller, cell) : null;
    }
    setGeo({
      table: rectIn(scroller, table),
      head: Array.from(table.rows[0]?.cells ?? [], (c) => rectIn(scroller, c)),
      body: Array.from(table.rows)
        .slice(1)
        .map((r) => rectIn(scroller, r)),
      edit: editBox,
      limitRight: scroller.clientWidth + scroller.scrollLeft - 18,
    });
  }, [scrollerRef, docRef, editing, drag, hover, coarse, html, tick]);

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

  const startDrag = (e: ReactPointerEvent<HTMLElement>, line: number, kind: "row" | "col", from: number) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ line, kind, from, boundary: from });
  };

  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const scroller = scrollerRef.current;
    if (!drag || !geo || !scroller) return;
    const s = scroller.getBoundingClientRect();
    const boundary =
      drag.kind === "col"
        ? boundaryIndex(
            geo.head.map((c) => c.left + c.width / 2),
            e.clientX - s.left + scroller.scrollLeft,
          )
        : boundaryIndex(
            geo.body.map((r) => r.top + r.height / 2),
            e.clientY - s.top + scroller.scrollTop,
          );
    if (boundary !== drag.boundary) setDrag({ ...drag, boundary });
  };

  const endDrag = () => {
    if (!drag) return;
    const d = drag;
    const to = moveTarget(d.from, d.boundary);
    setDrag(null);
    if (to !== d.from) {
      edit(d.line, (t) => (d.kind === "col" ? moveColumn(t, d.from, to) : moveRow(t, d.from, to)));
    }
  };

  const key = hover ?? drag;

  return (
    <>
      {children}
      <div className="table-tools">
        {!coarse && geo && !editing && key ? (
          <HoverControls
            geo={geo}
            drag={drag}
            onAddColumn={() => edit(key.line, (t) => insertColumn(t, t.header.length))}
            onAddRow={() => edit(key.line, (t) => insertRow(t, t.rows.length))}
            onGripDown={(e, kind, from) => startDrag(e, key.line, kind, from)}
            onGripMove={moveDrag}
            onGripUp={endDrag}
            onGripCancel={() => setDrag(null)}
          />
        ) : null}
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

interface HoverControlsProps {
  geo: Geo;
  drag: DragState | null;
  onAddColumn: () => void;
  onAddRow: () => void;
  onGripDown: (e: ReactPointerEvent<HTMLElement>, kind: "row" | "col", from: number) => void;
  onGripMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onGripUp: () => void;
  onGripCancel: () => void;
}

function HoverControls({
  geo,
  drag,
  onAddColumn,
  onAddRow,
  onGripDown,
  onGripMove,
  onGripUp,
  onGripCancel,
}: HoverControlsProps) {
  const { table, head, body } = geo;
  const gripProps = (kind: "row" | "col", i: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onGripDown(e, kind, i),
    onPointerMove: onGripMove,
    onPointerUp: onGripUp,
    onPointerCancel: onGripCancel,
  });
  let drop: Box | null = null;
  if (drag?.kind === "col") {
    const at = head[drag.boundary];
    const last = head[head.length - 1];
    const x = at ? at.left : last ? last.left + last.width : table.left;
    drop = { left: x - 1, top: table.top, width: 2, height: table.height };
  } else if (drag?.kind === "row") {
    const at = body[drag.boundary];
    const last = body[body.length - 1];
    const y = at ? at.top : last ? last.top + last.height : table.top;
    drop = { left: table.left, top: y - 1, width: table.width, height: 2 };
  }
  return (
    <>
      <button
        type="button"
        className="tt-add tt-add-col"
        aria-label="Add column"
        style={{ left: Math.min(table.left + table.width, geo.limitRight), top: table.top, height: table.height }}
        onClick={onAddColumn}
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        className="tt-add tt-add-row"
        aria-label="Add row"
        style={{ left: table.left, top: table.top + table.height, width: table.width }}
        onClick={onAddRow}
      >
        <PlusIcon />
      </button>
      {head.map((c, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a grip is a positional slot, not an item
          key={`c${i}`}
          className="tt-grip tt-grip-col"
          role="presentation"
          style={{ left: c.left + c.width / 2 - 12, top: table.top - 11 }}
          {...gripProps("col", i)}
        />
      ))}
      {body.map((r, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a grip is a positional slot, not an item
          key={`r${i}`}
          className="tt-grip tt-grip-row"
          role="presentation"
          style={{ left: table.left - 11, top: r.top + r.height / 2 - 12 }}
          {...gripProps("row", i)}
        />
      ))}
      {drop ? <div className="tt-drop" style={drop} /> : null}
    </>
  );
}
