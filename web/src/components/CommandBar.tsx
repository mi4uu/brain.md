import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { api } from "../api/client";
import type { SearchHit, TreeData } from "../api/types";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

interface Props {
  mode: "search" | "switcher" | null;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  tree: TreeData;
}

export function CommandBar({ mode, onClose, onOpenNote, tree }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const noteList = tree.notes;

  useEffect(() => {
    if (mode) {
      setQ("");
      setHits([]);
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "search") return;
    let cancelled = false;
    if (q.trim() === "") {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await api.search(q);
        if (!cancelled) setHits(r);
      } catch {
        if (!cancelled) setHits([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, mode]);

  const open = mode !== null;
  const placeholder =
    mode === "switcher" ? "Quick switch…" : "Search vault…";

  const select = (path: string) => {
    onOpenNote(path);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showClose={false}
        className="max-w-xl gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">
          {mode === "switcher" ? "Quick switcher" : "Search vault"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {mode === "switcher"
            ? "Type to fuzzy-match a note by path. Enter to open."
            : "Type to search note titles and body. Enter to open the top match."}
        </DialogDescription>
        <Command
          shouldFilter={mode === "switcher"}
          loop
          className="flex flex-col"
        >
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder={placeholder}
            className="w-full border-b border-border bg-transparent px-4 py-3 text-base text-fg-1 outline-none placeholder:text-fg-3"
          />
          <Command.List className="max-h-[60vh] overflow-y-auto p-1">
            <Command.Empty className="p-4 text-center text-sm text-fg-3">
              {q.trim() === "" ? "Type to begin…" : "No matches."}
            </Command.Empty>
            {mode === "switcher"
              ? noteList.map((p) => (
                  <SwitcherItem key={p} path={p} onSelect={select} />
                ))
              : hits.map((h) => (
                  <SearchItem key={h.path} hit={h} onSelect={select} />
                ))}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function SwitcherItem({
  path,
  onSelect,
}: {
  path: string;
  onSelect: (p: string) => void;
}) {
  const title = path.replace(/\.md$/, "").split("/").pop() ?? path;
  return (
    <Command.Item
      value={`${path} ${title}`}
      onSelect={() => onSelect(path)}
      className="flex cursor-default flex-col gap-0.5 rounded-1 px-3 py-2 text-sm text-fg-1 aria-selected:bg-hover"
    >
      <span className="font-medium">{title}</span>
      <span className="text-xs text-fg-3">{path}</span>
    </Command.Item>
  );
}

function SearchItem({
  hit,
  onSelect,
}: {
  hit: SearchHit;
  onSelect: (p: string) => void;
}) {
  return (
    <Command.Item
      value={hit.path}
      onSelect={() => onSelect(hit.path)}
      className="flex cursor-default flex-col gap-0.5 rounded-1 px-3 py-2 text-sm text-fg-1 aria-selected:bg-hover"
    >
      <span className="font-medium">{hit.title}</span>
      <span className="text-xs text-fg-3">{hit.path}</span>
      {hit.snippet ? (
        <span className="line-clamp-2 text-xs text-fg-2">{hit.snippet}</span>
      ) : null}
    </Command.Item>
  );
}
