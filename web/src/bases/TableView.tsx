import { memo, useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { columnId, setColumnSize, setViewGroupBy, setViewOrder, setViewSort, setViewSummary } from "@brainmd/shared/base-yaml";
import type { PropValue } from "@brainmd/shared/frontmatter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { EditableCell } from "./EditableCell";
import { RowMenu } from "./RowMenu";
import { DEFAULT_COLUMN_WIDTH, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, SUMMARY_NAMES, byColumn, clampWidth, matchKey, moveColumn, needsRowMenu, patchRowValues, propNameOf, summarise, toggleColumn } from "./model";
import type { Column, LayoutProps, PropChange, Row } from "./types";

export function TableView({ result, view, config, host, saveProps, editView }: LayoutProps) {
  const [live, setLive] = useState<Record<string, number>>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: new stored widths are the signal to drop live widths
  useEffect(() => setLive({}), [view.columnSize]);
  const rowCount = result.groups.reduce((n, g) => n + g.rows.length, 0);
  const widthOf = (key: string): number => live[key] ?? view.columnSize[columnId(key)] ?? DEFAULT_COLUMN_WIDTH;

  const commitWidth = (key: string, w: number) => {
    setLive((l) => ({ ...l, [key]: w }));
    editView((src, i) => setColumnSize(src, i, key, w));
  };

  const bumpWidth = (key: string, delta: number) => setLive((l) => ({ ...l, [key]: clampWidth((l[key] ?? view.columnSize[columnId(key)] ?? DEFAULT_COLUMN_WIDTH) + delta) }));
  const commitLive = (key: string) => {
    const w = live[key];
    if (w !== undefined && w !== (view.columnSize[columnId(key)] ?? DEFAULT_COLUMN_WIDTH)) commitWidth(key, w);
  };

  const dropLive = (key: string) =>
    setLive((l) => {
      const { [key]: _gone, ...rest } = l;
      return rest;
    });

  const startResize = (e: ReactPointerEvent<HTMLElement>, key: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = widthOf(key);
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = clampWidth(startW + ev.clientX - startX);
      setLive((l) => ({ ...l, [key]: w }));
    };
    const stop = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
    const up = () => {
      stop();
      if (w !== startW) commitWidth(key, w);
    };
    const cancel = () => {
      stop();
      dropLive(key);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
  };

  const summaryFor = (c: Column): string | undefined => summaryOf(view.summaries, config.summaries, c);
  const showSummaries = result.columns.some((c) => summaryFor(c));
  const ownSummaryKey = (c: Column): string => matchKey(view.summaries, c.key) ?? columnId(c.key);
  const inheritedOnly = (c: Column): boolean => matchKey(view.summaries, c.key) === undefined && matchKey(config.summaries, c.key) !== undefined;
  const sortedBy = (key: string) => view.sort.find((s) => columnId(s.property) === columnId(key))?.direction;

  const header = (c: Column) => (
    <th key={c.key} scope="col" className={numClass(c)} aria-sort={sortedBy(c.key) === "ASC" ? "ascending" : sortedBy(c.key) === "DESC" ? "descending" : "none"}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="base-th-btn" aria-label={`Column ${c.label}`}>
            {c.label}
            {sortedBy(c.key) === "ASC" ? <ArrowUpIcon className="base-sort-icon" aria-hidden /> : sortedBy(c.key) === "DESC" ? <ArrowDownIcon className="base-sort-icon" aria-hidden /> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="base-menu">
          <DropdownMenuItem onSelect={() => editView((src, i) => setViewSort(src, i, [{ property: c.key, direction: "ASC" }]))}>Sort ascending</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editView((src, i) => setViewSort(src, i, [{ property: c.key, direction: "DESC" }]))}>Sort descending</DropdownMenuItem>
          <DropdownMenuItem disabled={!sortedBy(c.key)} onSelect={() => editView((src, i) => setViewSort(src, i, view.sort.filter((s) => columnId(s.property) !== columnId(c.key))))}>Clear sort</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editView((src, i) => setViewGroupBy(src, i, { property: c.key, direction: "ASC" }))}>Group by this</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Position</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="base-menu">
              <DropdownMenuItem onSelect={() => editView((src, i) => setViewOrder(src, i, moveColumn(view.order, c.key, -1)))}>Move left</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editView((src, i) => setViewOrder(src, i, moveColumn(view.order, c.key, 1)))}>Move right</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Width</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="base-menu">
              <DropdownMenuItem onSelect={() => commitWidth(c.key, clampWidth(widthOf(c.key) + 40))}>Wider</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => commitWidth(c.key, clampWidth(widthOf(c.key) - 40))}>Narrower</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={result.columns.length < 2} onSelect={() => editView((src, i) => setViewOrder(src, i, toggleColumn(view.order, c.key)))}>Hide column</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Summary</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="base-menu">
              <DropdownMenuItem disabled={inheritedOnly(c)} onSelect={() => editView((src, i) => setViewSummary(src, i, ownSummaryKey(c), null))}>
                {inheritedOnly(c) ? "None (set in the base, edit the source)" : "None"}
              </DropdownMenuItem>
              {SUMMARY_NAMES.map((n) => (
                <DropdownMenuItem key={n} onSelect={() => editView((src, i) => setViewSummary(src, i, ownSummaryKey(c), n))}>{n}</DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* biome-ignore lint/a11y/useSemanticElements: a focusable separator is the ARIA window splitter; <hr> cannot take drags or arrow keys here */}
      <span
        className="base-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${c.label}`}
        aria-valuenow={widthOf(c.key)}
        aria-valuemin={MIN_COLUMN_WIDTH}
        aria-valuemax={MAX_COLUMN_WIDTH}
        tabIndex={0}
        onPointerDown={(e) => startResize(e, c.key)}
        onBlur={() => commitLive(c.key)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") bumpWidth(c.key, -10);
          else if (e.key === "ArrowRight") bumpWidth(c.key, 10);
          else if (e.key === "Enter") commitLive(c.key);
          else if (e.key === "Escape") dropLive(c.key);
          else return;
          e.preventDefault();
        }}
      />
    </th>
  );

  return (
    <div className="base-table-wrap">
      <table className="base-table">
        <colgroup>
          {result.columns.map((c) => (
            <col key={c.key} style={{ width: widthOf(c.key) }} />
          ))}
          {needsRowMenu(result.columns) ? <col className="base-col-menu" /> : null}
        </colgroup>
        <thead>
          <tr>
            {result.columns.map(header)}
            {needsRowMenu(result.columns) ? <th aria-label="Row actions" /> : null}
          </tr>
        </thead>
        <TableBody result={result} host={host} saveProps={saveProps} />
        {showSummaries ? <TableFoot result={result} viewSummaries={view.summaries} baseSummaries={config.summaries} /> : null}
      </table>
      {showSummaries && rowCount < result.total ? <p className="base-summary-note">Summaries cover the first {rowCount} of {result.total} notes</p> : null}
    </div>
  );
}

const numClass = (c: Column): string | undefined => (c.type === "number" ? "base-num" : undefined);

const summaryOf = (own: Record<string, string>, base: Record<string, string>, c: Column): string | undefined => byColumn(own, c.key) ?? byColumn(base, c.key);

// Widths live on <col>, so the rows and the footer are memoised: a live resize
// re-renders only the colgroup and the header, not every row.
const TableBody = memo(function TableBody({ result, host, saveProps }: Pick<LayoutProps, "result" | "host" | "saveProps">) {
  const grouped = result.groups.some((g) => g.label !== "");
  const menu = needsRowMenu(result.columns);
  const save = (row: Row, change: PropChange) => {
    const patch: Record<string, PropValue> = {};
    for (const name of [...Object.keys(change.set ?? {}), ...(change.unset ?? [])]) {
      for (const c of result.columns) if (propNameOf(c.key) === name) patch[c.key] = change.set && name in change.set ? change.set[name]! : null;
    }
    return saveProps(row, change, (r) => patchRowValues(r, row.path, patch));
  };
  return result.groups.map((g) => (
    <tbody key={g.key ?? "\u0000none"}>
      {grouped ? (
        <tr className="base-group">
          <td colSpan={result.columns.length + (menu ? 1 : 0)}>
            {g.label} <span className="base-count">{g.count}</span>
          </td>
        </tr>
      ) : null}
      {g.rows.map((r) => (
        <tr key={r.path}>
          {result.columns.map((c) => (
            <td key={c.key} className={numClass(c)}>
              <EditableCell col={c} value={r.values[c.key] ?? null} row={r} host={host} onCommit={(change) => save(r, change)} />
            </td>
          ))}
          {menu ? (
            <td className="base-td-menu">
              <RowMenu row={r} host={host} />
            </td>
          ) : null}
        </tr>
      ))}
    </tbody>
  ));
});

const TableFoot = memo(function TableFoot({ result, viewSummaries, baseSummaries }: { result: LayoutProps["result"]; viewSummaries: Record<string, string>; baseSummaries: Record<string, string> }) {
  const rows = result.groups.flatMap((g) => g.rows);
  return (
    <tfoot>
      <tr>
        {result.columns.map((c) => {
          const name = summaryOf(viewSummaries, baseSummaries, c);
          const v = name ? summarise(name, rows.map((r) => r.values[c.key] ?? null)) : null;
          return (
            <td key={c.key} className={numClass(c)}>
              {name && v !== null ? (
                <>
                  <span className="base-sum-name">{name}</span> {v}
                </>
              ) : null}
            </td>
          );
        })}
        {needsRowMenu(result.columns) ? <td /> : null}
      </tr>
    </tfoot>
  );
});
