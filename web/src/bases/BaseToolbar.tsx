import type { ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, DashboardIcon, ListBulletIcon, TableIcon, ViewVerticalIcon } from "@radix-ui/react-icons";
import { addView, deleteView, renameView, setViewType } from "@brainmd/shared/base-yaml";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { VIEW_TYPES, cap, freshName, isNameTaken, nextView, wasApplied } from "./toolbar";

export { VIEW_TYPES };

export function TypeIcon({ type }: { type: string }) {
  if (type === "cards") return <DashboardIcon aria-hidden />;
  if (type === "list") return <ListBulletIcon aria-hidden />;
  if (type === "kanban") return <ViewVerticalIcon aria-hidden />;
  return <TableIcon aria-hidden />;
}

interface Props {
  result: BaseQueryResponse;
  viewIndex: number;
  onSwitch(name: string): void;
  // false means the splice was refused; the host has already shown the toast and nothing changed.
  editView(fn: (source: string, viewIndex: number) => string): boolean | void;
  toast(message: string): void;
  tools?: ReactNode;
}

export function BaseToolbar({ result, viewIndex, onSwitch, editView, toast, tools }: Props) {
  const current = result.views[viewIndex] ?? result.views[0];
  const names = result.views.map((v) => v.name);
  const applied = wasApplied;
  return (
    <div className="base-toolbar">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="btn base-btn base-switch" aria-label={`View: ${current?.name ?? ""}`}>
            <TypeIcon type={current?.type ?? "table"} />
            <span className="base-switch-name">{current?.name ?? "Table"}</span>
            <span className="base-count" aria-hidden>{result.total}</span>
            <span className="sr-only">{result.total} notes</span>
            <ChevronDownIcon aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="base-menu">
          <DropdownMenuLabel>Views</DropdownMenuLabel>
          {result.views.map((v) => (
            <DropdownMenuItem key={v.name} onSelect={() => onSwitch(v.name)}>
              <TypeIcon type={v.type} />
              <span>{v.name}</span>
              {v.name === current?.name ? <CheckIcon className="ml-auto" aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Add view</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="base-menu">
              {VIEW_TYPES.map((t) => (
                <DropdownMenuItem
                  key={t}
                  onSelect={() => {
                    const name = freshName(cap(t), names);
                    if (applied(editView((src) => addView(src, { type: t, name })))) onSwitch(name);
                  }}
                >
                  <TypeIcon type={t} />
                  <span>{cap(t)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>View type</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="base-menu">
              {VIEW_TYPES.map((t) => (
                <DropdownMenuItem key={t} onSelect={() => editView((src, i) => setViewType(src, i, t))}>
                  <TypeIcon type={t} />
                  <span>{cap(t)}</span>
                  {current?.type === t ? <CheckIcon className="ml-auto" aria-hidden /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() => {
              const name = window.prompt("View name", current?.name ?? "")?.trim();
              if (!name || name === current?.name) return;
              if (isNameTaken(names, name, viewIndex)) {
                toast(`A view named "${name}" already exists`);
                return;
              }
              if (applied(editView((src, i) => renameView(src, i, name)))) onSwitch(name);
            }}
          >
            Rename view
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={result.views.length < 2}
            onSelect={() => {
              if (!window.confirm(`Delete the view "${current?.name}"?`)) return;
              const next = nextView(result.views, viewIndex);
              if (applied(editView((src, i) => deleteView(src, i))) && next) onSwitch(next);
            }}
          >
            Delete view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="base-tools">{tools}</div>
    </div>
  );
}
