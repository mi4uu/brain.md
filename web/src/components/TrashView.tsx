import { useCallback, useEffect, useState } from "react";

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
  const [items, setItems] = useState<TrashItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/trash");
      if (!res.ok) throw new Error(`${res.status}`);
      setItems((await res.json()) as TrashItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const restore = async (p: string) => {
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
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const filesOnly = items.filter((i) => !i.isDir);

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="settings-panel" role="dialog" aria-modal="true" style={{ width: "min(720px, calc(100vw - 32px))" }}>
        <h2>Trash</h2>
        {error ? <p style={{ color: "var(--callout-danger)" }}>{error}</p> : null}
        <div className="scroll" style={{ maxHeight: "60vh" }}>
          {filesOnly.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: 24 }}>Trash is empty.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {filesOnly.map((i) => (
                <li
                  key={i.path}
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i.path.replace(/^\.brain\/trash\/[^/]+\//, "")}
                  </div>
                  <span style={{ fontSize: "var(--text-xs)", color: "var(--text-3)" }}>
                    {new Date(i.mtime).toLocaleString()}
                  </span>
                  <button className="btn" onClick={() => restore(i.path)}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </>
  );
}
