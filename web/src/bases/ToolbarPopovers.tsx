import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CaretSortIcon, Cross2Icon, MixerHorizontalIcon, PlusIcon } from "@radix-ui/react-icons";
import type { ViewConfig } from "@brainmd/shared/base-parse";
import type { SortSpec } from "@brainmd/shared/base-types";
import { setViewFilters, setViewOrder, setViewSort } from "@brainmd/shared/base-yaml";
import { ColumnsIcon } from "../components/Icons";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { filtersFrom, flatFilters } from "./model";
import {
  FILTER_OPS,
  type FilterOp,
  type KeyOption,
  addSort,
  buildFilter,
  flipSort,
  hiddenOptions,
  hideColumn,
  labelOf,
  optionKeyFor,
  removeSort,
  replaceFilter,
  setSortProperty,
  shiftColumn,
  showColumn,
  sortChoices,
} from "./toolbar";

export type { KeyOption };

type EditView = (fn: (source: string, viewIndex: number) => string) => void;

interface OpenProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function SortPopover({ view, options, editView, open, onOpenChange }: { view: ViewConfig; options: KeyOption[]; editView: EditView } & OpenProps) {
  const set = (next: SortSpec[] | null) => next && editView((src, i) => setViewSort(src, i, next));
  const canAdd = addSort(view.sort, options) !== null;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="btn base-btn" aria-label="Sort">
          <CaretSortIcon aria-hidden />
          <span className="base-btn-text">Sort</span>
          {view.sort.length > 0 ? <span className="base-count">{view.sort.length}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="base-pop">
        {view.sort.length === 0 ? <p className="base-hint">No sort. Rows follow file name.</p> : null}
        {view.sort.map((s, i) => {
          const value = optionKeyFor(options, s.property);
          const choices = sortChoices(view.sort, options, i);
          return (
            <div className="base-pop-row" key={`${s.property}-${i}`}>
              <select
                className="base-select"
                aria-label="Sort property"
                value={value}
                onChange={(e) => set(setSortProperty(view.sort, i, e.target.value))}
              >
                {!choices.some((o) => o.key === value) ? <option value={value}>{labelOf(options, s.property)}</option> : null}
                {choices.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn base-btn icon"
                aria-label={`Direction ${s.direction === "ASC" ? "ascending" : "descending"}, switch`}
                onClick={() => set(flipSort(view.sort, i))}
              >
                {s.direction === "ASC" ? <ArrowUpIcon aria-hidden /> : <ArrowDownIcon aria-hidden />}
              </button>
              <button type="button" className="btn base-btn icon" aria-label="Remove sort" onClick={() => set(removeSort(view.sort, i))}>
                <Cross2Icon aria-hidden />
              </button>
            </div>
          );
        })}
        <button type="button" className="btn base-btn" disabled={!canAdd} onClick={() => set(addSort(view.sort, options))}>
          <PlusIcon aria-hidden /> Add sort
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function FilterPopover({ view, options, editView, open, onOpenChange }: { view: ViewConfig; options?: KeyOption[]; editView: EditView } & OpenProps) {
  const flat = flatFilters(view.filters);
  const props = options ?? [];
  const [draft, setDraft] = useState("");
  const [key, setKey] = useState("");
  const [op, setOp] = useState<FilterOp>("is");
  const [value, setValue] = useState("");
  const commit = (next: string[]) => editView((src, i) => setViewFilters(src, i, filtersFrom(next)));
  const meta = FILTER_OPS.find((o) => o.id === op)!;
  const built = buildFilter(key || props[0]?.key || "", op, value);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="btn base-btn" aria-label="Filter">
          <MixerHorizontalIcon aria-hidden />
          <span className="base-btn-text">Filter</span>
          {flat === null || flat.length > 0 ? <span className="base-count">{flat === null ? "…" : flat.length}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="base-pop base-pop-wide">
        {flat === null ? (
          <p className="base-hint">This filter uses nested and / or / not groups. Edit it in the block source.</p>
        ) : (
          <>
            <p className="base-hint">All of these must hold. Example: status == "Todo"</p>
            {flat.map((expr, i) => (
              <div className="base-pop-row" key={`${i}:${expr}`}>
                <input
                  className="base-input"
                  aria-label={`Filter ${i + 1}`}
                  defaultValue={expr}
                  spellCheck={false}
                  onBlur={(e) => {
                    const next = replaceFilter(flat, i, e.target.value);
                    if (next) commit(next);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <button type="button" className="btn base-btn icon" aria-label="Remove filter" onClick={() => commit(flat.filter((_, j) => j !== i))}>
                  <Cross2Icon aria-hidden />
                </button>
              </div>
            ))}
            {props.length > 0 ? (
              <div className="base-pop-row base-pop-wrap">
                <select className="base-select" aria-label="Filter property" value={key || props[0]!.key} onChange={(e) => setKey(e.target.value)}>
                  {props.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                <select className="base-select" aria-label="Filter operator" value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
                  {FILTER_OPS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                {meta.needsValue ? (
                  <input className="base-input" aria-label="Filter value" value={value} onChange={(e) => setValue(e.target.value)} />
                ) : null}
                <button
                  type="button"
                  className="btn base-btn icon"
                  aria-label="Add filter from builder"
                  disabled={built === null}
                  onClick={() => {
                    if (built === null) return;
                    commit([...flat, built]);
                    setValue("");
                  }}
                >
                  <PlusIcon aria-hidden />
                </button>
              </div>
            ) : null}
            <div className="base-pop-row">
              <input
                className="base-input"
                aria-label="New filter"
                placeholder='file.hasTag("work")'
                value={draft}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) {
                    commit([...flat, draft]);
                    setDraft("");
                  }
                }}
              />
              <button
                type="button"
                className="btn base-btn icon"
                aria-label="Add filter"
                disabled={!draft.trim()}
                onClick={() => {
                  commit([...flat, draft]);
                  setDraft("");
                }}
              >
                <PlusIcon aria-hidden />
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function PropertiesPopover({ view, options, editView, open, onOpenChange }: { view: ViewConfig; options: KeyOption[]; editView: EditView } & OpenProps) {
  const shown = view.order.length > 0 ? view.order : ["file.name"];
  const set = (next: string[] | null) => next && editView((src, i) => setViewOrder(src, i, next));
  const rest = hiddenOptions(view.order, options);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="btn base-btn" aria-label="Properties">
          <ColumnsIcon aria-hidden />
          <span className="base-btn-text">Properties</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="base-pop">
        {shown.map((key, i) => {
          const label = labelOf(options, key);
          return (
            <div className="base-pop-row" key={key}>
              <span className="base-pop-label">{label}</span>
              <button type="button" className="btn base-btn icon" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => set(shiftColumn(view.order, key, -1))}>
                <ArrowUpIcon aria-hidden />
              </button>
              <button type="button" className="btn base-btn icon" aria-label={`Move ${label} down`} disabled={i === shown.length - 1} onClick={() => set(shiftColumn(view.order, key, 1))}>
                <ArrowDownIcon aria-hidden />
              </button>
              <button type="button" className="btn base-btn icon" aria-label={`Hide ${label}`} disabled={shown.length === 1} onClick={() => set(hideColumn(view.order, key))}>
                <Cross2Icon aria-hidden />
              </button>
            </div>
          );
        })}
        <select className="base-select" aria-label="Add property" value="" onChange={(e) => e.target.value && set(showColumn(view.order, e.target.value))}>
          <option value="">Add property…</option>
          {rest.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </PopoverContent>
    </Popover>
  );
}
