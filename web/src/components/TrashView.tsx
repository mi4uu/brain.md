import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";

interface TrashItem {
  path: string;
  mtime: number;
  isDir: boolean;
}

interface Props {
  onClose: () => void;
  onRestored: () => void;
}

export function TrashView({ onClose, onRestored }: Props) {
  const [items, setItems] = useState<TrashItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/trash");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems((await res.json()) as TrashItem[]);
      setError(null);
    } catch (e) {
      setItems((prev) => prev ?? []);
      setError(`Could not load the trash (${e instanceof Error ? e.message : String(e)}).`);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const restore = async (p: string) => {
    setRestoring(p);
    try {
      const res = await fetch("/api/trash/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trashPath: p }),
      });
      if (!res.ok) throw new Error(await res.text());
      await reload();
      onRestored();
    } catch (e) {
      setError(`Could not restore ${displayPath(p)}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRestoring(null);
    }
  };

  const filesOnly = (items ?? []).filter((i) => !i.isDir);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <DialogDescription>Notes deleted from the vault. Restore puts a note back at its path.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-callout-danger">
            {error}
          </p>
        ) : null}
        {items === null ? (
          <p className="tasks-empty">Loading trash</p>
        ) : filesOnly.length === 0 ? (
          <p className="tasks-empty">Trash is empty.</p>
        ) : (
          <ul className="trash-list">
            {filesOnly.map((i) => (
              <li key={i.path} className="trash-row">
                <span className="trash-path" title={displayPath(i.path)}>
                  {displayPath(i.path)}
                </span>
                <span className="trash-date">{new Date(i.mtime).toLocaleString()}</span>
                <button
                  type="button"
                  className="btn"
                  disabled={restoring !== null}
                  onClick={() => void restore(i.path)}
                >
                  {restoring === i.path ? "Restoring" : "Restore"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function displayPath(p: string): string {
  return p.replace(/^\.brain\/trash\/[^/]+\//, "");
}
