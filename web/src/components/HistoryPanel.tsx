import { useCallback, useEffect, useState } from "react";
import { gitApi, type GitCommit } from "../api/git";
import { DiffView } from "./DiffView";

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
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="history-panel" role="dialog" aria-modal="true">
        <header>
          <h2>History</h2>
          {path ? (
            <div className="seg-tabs">
              <button
                className={`seg ${scope === "note" ? "active" : ""}`}
                onClick={() => setScope("note")}
              >
                This note
              </button>
              <button
                className={`seg ${scope === "vault" ? "active" : ""}`}
                onClick={() => setScope("vault")}
              >
                All vault
              </button>
            </div>
          ) : (
            <span className="muted" style={{ fontSize: "var(--text-sm)" }}>All vault</span>
          )}
          {path && scope === "note" ? (
            <span className="muted" style={{ fontSize: "var(--text-sm)" }}>— {path}</span>
          ) : null}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => void reload()}>Refresh</button>
          <button className="btn" onClick={onClose}>Close</button>
        </header>
        {error ? <p style={{ color: "var(--callout-danger)", padding: "0 16px" }}>{error}</p> : null}
        <div className="history-body">
          <aside className="history-list scroll">
            {log.length === 0 ? (
              <p className="muted" style={{ padding: 16, textAlign: "center" }}>
                {scope === "note"
                  ? "No commits touching this note yet. Try All vault."
                  : "No commits yet."}
              </p>
            ) : (
              log.map((c) => (
                <div
                  key={c.sha}
                  className={`history-item${selected?.sha === c.sha ? " active" : ""}`}
                  onClick={() => setSelected(c)}
                >
                  <div className="hi-subject">{c.subject || "(no message)"}</div>
                  <div className="hi-meta">
                    <span>{c.sha.slice(0, 7)}</span>
                    <span>·</span>
                    <span>{new Date(c.ts).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </aside>
          <section className="history-diff">
            {selected ? (
              <>
                <div className="history-diff-head">
                  <div>
                    <strong>{selected.subject}</strong>{" "}
                    <span className="muted">{selected.sha.slice(0, 7)}</span>
                  </div>
                  {path ? (
                    <button className="btn primary" onClick={restore}>
                      Restore this version
                    </button>
                  ) : null}
                </div>
                {loadingPatch ? <p className="muted" style={{ padding: 16 }}>loading…</p> : <DiffView patch={patch} />}
              </>
            ) : (
              <p className="muted" style={{ padding: 16, textAlign: "center" }}>Select a commit.</p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
