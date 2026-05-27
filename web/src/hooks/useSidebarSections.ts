import { useCallback, useEffect, useState } from "react";

// V43: per-section collapse state persisted to localStorage
// (device-local, NOT vault). Keys = `brain.sidebar.<id>`. Value = "1"|"0".
// First-load default per id passed by caller.

const KEY_PREFIX = "brain.sidebar.";

export type SidebarSectionId =
  | "bookmarks"
  | "vault"
  | "tags"
  | "outline"
  | "backlinks"
  | "related";

function readInitial(ids: SidebarSectionId[], defaults: Record<SidebarSectionId, boolean>): SidebarSectionId[] {
  if (typeof window === "undefined") {
    return ids.filter((id) => defaults[id]);
  }
  const open: SidebarSectionId[] = [];
  for (const id of ids) {
    const stored = window.localStorage.getItem(KEY_PREFIX + id);
    const isOpen = stored === null ? defaults[id] : stored === "1";
    if (isOpen) open.push(id);
  }
  return open;
}

export function useSidebarSections(
  ids: SidebarSectionId[],
  defaults: Record<SidebarSectionId, boolean>,
): { open: SidebarSectionId[]; setOpen: (next: SidebarSectionId[]) => void } {
  const [open, setOpenState] = useState<SidebarSectionId[]>(() =>
    readInitial(ids, defaults),
  );

  // re-sync if defaults change (rare; mostly stable identity)
  useEffect(() => {
    setOpenState(readInitial(ids, defaults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setOpen = useCallback(
    (next: SidebarSectionId[]) => {
      setOpenState(next);
      if (typeof window === "undefined") return;
      const nextSet = new Set(next);
      for (const id of ids) {
        window.localStorage.setItem(
          KEY_PREFIX + id,
          nextSet.has(id) ? "1" : "0",
        );
      }
    },
    [ids],
  );

  return { open, setOpen };
}
