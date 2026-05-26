import { useEffect, useState } from "react";

interface TaskItem {
  path: string;
  lineNo: number;
  done: boolean;
  text: string;
}

interface Props {
  onOpen: (path: string) => void;
  onClose: () => void;
}

export function TasksView({ onOpen, onClose }: Props) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "done">("open");

  useEffect(() => {
    void fetch("/api/tasks")
      .then((r) => r.json() as Promise<TaskItem[]>)
      .then(setTasks)
      .catch(() => setTasks([]));
  }, []);

  const visible = tasks.filter((t) =>
    filter === "all" ? true : filter === "open" ? !t.done : t.done,
  );

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="settings-panel" role="dialog" aria-modal="true" style={{ width: "min(720px, calc(100vw - 32px))" }}>
        <h2>Tasks</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className={`btn${filter === "open" ? " primary" : ""}`} onClick={() => setFilter("open")}>Open ({tasks.filter((t) => !t.done).length})</button>
          <button className={`btn${filter === "done" ? " primary" : ""}`} onClick={() => setFilter("done")}>Done ({tasks.filter((t) => t.done).length})</button>
          <button className={`btn${filter === "all" ? " primary" : ""}`} onClick={() => setFilter("all")}>All ({tasks.length})</button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div className="scroll" style={{ maxHeight: "60vh" }}>
          {visible.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", padding: 24 }}>No tasks.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {visible.map((t, i) => (
                <li
                  key={`${t.path}:${t.lineNo}:${i}`}
                  onClick={() => onOpen(t.path)}
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                  }}
                >
                  <span style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    border: "1px solid var(--border-strong)",
                    background: t.done ? "var(--accent)" : "transparent",
                    flexShrink: 0,
                    marginTop: 2,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--text-3)" : "var(--text-1)" }}>{t.text}</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text-3)" }}>{t.path} · L{t.lineNo}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
