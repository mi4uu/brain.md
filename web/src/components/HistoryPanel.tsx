import { useCallback, useEffect, useState } from "react";
import { gitApi, type GitCommit } from "../api/git";
import { DiffView } from "./DiffView";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";

interface Props {
  path: string | null;
  onClose: () => void;
  onRestored: () => void;
}

type Scope = "note" | "vault";

export function HistoryPanel({ path, onClose, onRestored }: Props) {
  const [scope, setScope] = useState<Scope>(path ? "note" : "vault");
  const [log, setLog] = useState<GitCommit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GitCommit | null>(null);
  const [patch, setPatch] = useState<string>("");
  const [loadingPatch, setLoadingPatch] = useState(false);

  const filterPath = scope === "note" && path ? path : undefined;

  const reload = useCallback(async () => {
    setError(null);
    try {
      const items = await gitApi.log({ path: filterPath, limit: 200 });
      setLog(items);
      setSelected(items[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [filterPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selected || !path) {
      setPatch("");
      return;
    }
    let cancelled = false;
    setLoadingPatch(true);
    void gitApi
      .diff(selected.sha, path)
      .then((d) => {
        if (!cancelled) setPatch(d.patch);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingPatch(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, path]);

  const restore = async () => {
    if (!selected || !path) return;
    if (!confirm(`Restore "${path}" to ${selected.sha.slice(0, 7)}?\n"${selected.subject}"`)) return;
    try {
      await gitApi.restore(path, selected.sha);
      onRestored();
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="grid h-[80vh] max-w-5xl grid-rows-[auto_auto_1fr] gap-0 p-0">
        <DialogHeader className="flex flex-row items-center gap-3 border-b border-border px-4 py-3">
          <DialogTitle className="text-md font-semibold">History</DialogTitle>
          {path ? (
            <div className="inline-flex items-center gap-0.5 rounded-2 border border-border bg-surface-alt p-0.5 text-sm">
              <button
                type="button"
                className={`rounded-1 px-2 py-1 ${scope === "note" ? "bg-surface-elev text-fg-1 shadow-1" : "text-fg-3"}`}
                onClick={() => setScope("note")}
              >
                This note
              </button>
              <button
                type="button"
                className={`rounded-1 px-2 py-1 ${scope === "vault" ? "bg-surface-elev text-fg-1 shadow-1" : "text-fg-3"}`}
                onClick={() => setScope("vault")}
              >
                All vault
              </button>
            </div>
          ) : (
            <span className="text-sm text-fg-3">All vault</span>
          )}
          {path && scope === "note" ? (
            <span className="truncate text-sm text-fg-3">— {path}</span>
          ) : null}
          <span className="flex-1" />
          <button
            type="button"
            className="rounded-1 px-2 py-1 text-sm text-fg-2 hover:bg-hover"
            onClick={() => void reload()}
          >
            Refresh
          </button>
        </DialogHeader>
        <DialogDescription className="sr-only">
          List of git commits with diff preview and restore action.
        </DialogDescription>
        {error ? (
          <p className="px-4 py-2 text-sm text-callout-danger">{error}</p>
        ) : (
          <div />
        )}
        <div className="grid min-h-0 grid-cols-[280px_1fr]">
          <ScrollArea className="border-r border-border">
            <div className="p-2">
              {log.length === 0 ? (
                <p className="p-3 text-center text-sm text-fg-3">
                  {scope === "note"
                    ? "No commits touching this note yet. Try All vault."
                    : "No commits yet."}
                </p>
              ) : (
                log.map((c) => (
                  <button
                    key={c.sha}
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`flex w-full flex-col gap-0.5 rounded-1 px-2 py-1.5 text-left text-sm transition-colors duration-fast ${
                      selected?.sha === c.sha
                        ? "bg-accent-soft text-accent"
                        : "text-fg-1 hover:bg-hover"
                    }`}
                  >
                    <span className="truncate font-medium">
                      {c.subject || "(no message)"}
                    </span>
                    <span className="flex gap-1 text-xs text-fg-3">
                      <span>{c.sha.slice(0, 7)}</span>
                      <span>·</span>
                      <span>{new Date(c.ts).toLocaleString()}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
          <ScrollArea>
            {selected ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                  <div className="min-w-0 truncate">
                    <strong className="text-sm">{selected.subject}</strong>{" "}
                    <span className="text-xs text-fg-3">
                      {selected.sha.slice(0, 7)}
                    </span>
                  </div>
                  {path ? (
                    <button
                      type="button"
                      onClick={restore}
                      className="shrink-0 rounded-1 bg-accent px-3 py-1 text-sm font-medium text-white hover:bg-accent-strong"
                    >
                      Restore this version
                    </button>
                  ) : null}
                </div>
                {loadingPatch ? (
                  <p className="p-4 text-sm text-fg-3">loading…</p>
                ) : (
                  <DiffView patch={patch} />
                )}
              </div>
            ) : (
              <p className="p-4 text-center text-sm text-fg-3">
                Select a commit.
              </p>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
