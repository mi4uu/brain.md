import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gitApi, type ChangeCommit, type ChangesPage } from "../api/git";
import { isNew, unseenShas } from "./model";

const REFRESH_MS = 60_000;

export interface ChangesState {
  showHidden: boolean;
  available: boolean;
  loaded: boolean;
  error: string | null;
  page: ChangesPage | null;
  unseen: Set<string>;
  unseenCount: number;
  unseenPaths: Set<string>;
  latestByPath: Map<string, { actor: string; ts: number; kind: string }>;
  reload: () => Promise<void>;
  markAllSeen: () => Promise<void>;
}

export function useChanges(showHidden: boolean): ChangesState {
  const [raw, setPage] = useState<ChangesPage | null>(null);
  const page = useMemo(() => (raw ? withoutHidden(raw, showHidden) : null), [raw, showHidden]);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);

  const reload = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      // A reload asked for mid-flight (right after a revert) must still
      // see the newest history, so run once more when this one ends.
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const p = await gitApi.changes({ limit: 200 });
      setPage(p);
      setAvailable(p.enabled);
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 401/403: not the owner (agent credential or logged out), the feed
      // simply does not exist for this session.
      if (/^40[13]/.test(msg)) setAvailable(false);
      else setError(msg);
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
    if (again.current) {
      again.current = false;
      await reload();
    }
  }, []);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), REFRESH_MS);
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  const derived = useMemo(() => {
    const commits: ChangeCommit[] = page?.commits ?? [];
    const unseen = unseenShas(commits, page?.seen ?? null);
    const unseenPaths = new Set<string>();
    const counted = new Set<string>();
    const latestByPath = new Map<string, { actor: string; ts: number; kind: string }>();
    let unseenCount = 0;
    for (const c of commits) {
      for (const f of c.files) {
        if (!latestByPath.has(f.path)) latestByPath.set(f.path, { actor: f.actor, ts: c.ts, kind: f.actorKind });
        if (!isNew(f.actorKind, unseen.has(c.sha)) || counted.has(f.path)) continue;
        // A deleted note counts as news too; only the tree, which no longer
        // lists it, gets no dot.
        counted.add(f.path);
        unseenCount++;
        if (f.status !== "deleted") unseenPaths.add(f.path);
      }
    }
    return { unseen, unseenPaths, unseenCount, latestByPath };
  }, [page]);

  const markAllSeen = useCallback(async () => {
    // The newest commit of all, hidden ones included, so nothing older
    // stays "new" behind the filter.
    const newest = raw?.commits[0];
    if (!newest) return;
    const seen = await gitApi.markSeen(newest.sha);
    setPage((p) => (p ? { ...p, seen, commits: p.commits.map((c) => ({ ...c, afterSeen: false })) } : p));
  }, [raw]);

  return { showHidden, available, loaded, error, page, reload, markAllSeen, ...derived };
}

export function withoutHidden(p: ChangesPage, showHidden: boolean): ChangesPage {
  if (showHidden) return p;
  const commits = p.commits
    .map((c) => (c.files.some((f) => f.hidden) ? { ...c, files: c.files.filter((f) => !f.hidden) } : c))
    .filter((c) => c.files.length > 0);
  return { ...p, commits };
}

// Paths with agent changes the owner has not seen yet; the file tree marks them.
export const UnseenPathsContext = createContext<Set<string>>(new Set());
