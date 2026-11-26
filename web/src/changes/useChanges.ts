import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { gitApi, type ChangeCommit, type ChangesPage } from "../api/git";
import { isNew, unseenShas } from "./model";

const REFRESH_MS = 60_000;

export interface ChangesState {
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

export function useChanges(): ChangesState {
  const [page, setPage] = useState<ChangesPage | null>(null);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
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
    const latestByPath = new Map<string, { actor: string; ts: number; kind: string }>();
    let unseenCount = 0;
    for (const c of commits) {
      for (const f of c.files) {
        if (!latestByPath.has(f.path)) latestByPath.set(f.path, { actor: f.actor, ts: c.ts, kind: f.actorKind });
        if (isNew(f.actorKind, unseen.has(c.sha)) && f.status !== "deleted" && !unseenPaths.has(f.path)) {
          unseenPaths.add(f.path);
          unseenCount++;
        }
      }
    }
    return { unseen, unseenPaths, unseenCount, latestByPath };
  }, [page]);

  const markAllSeen = useCallback(async () => {
    const newest = page?.commits[0];
    if (!newest) return;
    const seen = await gitApi.markSeen(newest.sha, newest.ts);
    setPage((p) => (p ? { ...p, seen } : p));
  }, [page]);

  return { available, loaded, error, page, reload, markAllSeen, ...derived };
}

// Paths with agent changes the owner has not seen yet; the file tree marks them.
export const UnseenPathsContext = createContext<Set<string>>(new Set());
