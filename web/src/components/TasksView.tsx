import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

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

type Filter = "open" | "done" | "all";

export function TasksView({ onOpen, onClose }: Props) {
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("open");

  useEffect(() => {
    void fetch("/api/tasks")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<TaskItem[]>;
      })
      .then(setTasks)
      .catch((e: unknown) => {
        setTasks([]);
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  const all = tasks ?? [];
  const openCount = all.filter((t) => !t.done).length;
  const visible = all.filter((t) => (filter === "all" ? true : filter === "open" ? !t.done : t.done));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tasks</DialogTitle>
          <DialogDescription>Checkboxes from every note in the vault.</DialogDescription>
        </DialogHeader>
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            <TabsTrigger value="open">
              Open <span className="tasks-count">{openCount}</span>
            </TabsTrigger>
            <TabsTrigger value="done">
              Done <span className="tasks-count">{all.length - openCount}</span>
            </TabsTrigger>
            <TabsTrigger value="all">
              All <span className="tasks-count">{all.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {error ? <p className="text-sm text-callout-danger">Could not load tasks ({error}).</p> : null}
        {tasks === null ? (
          <p className="tasks-empty">Loading tasks</p>
        ) : visible.length === 0 && !error ? (
          <p className="tasks-empty">
            {filter === "open" ? "No open tasks." : filter === "done" ? "No finished tasks yet." : "No tasks in the vault."}
          </p>
        ) : (
          <ul className="tasks-list">
            {visible.map((t, i) => (
              <li key={`${t.path}:${t.lineNo}:${i}`}>
                <button type="button" className="tasks-row" onClick={() => onOpen(t.path)}>
                  <span className={`tasks-box${t.done ? " is-done" : ""}`} aria-hidden="true" />
                  <span className="tasks-body">
                    <span className={`tasks-text${t.done ? " is-done" : ""}`}>{t.text}</span>
                    <span className="tasks-meta">
                      {t.path.replace(/\.md$/, "")} · L{t.lineNo}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
