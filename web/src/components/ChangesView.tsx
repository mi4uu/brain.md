import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { gitApi, RevertFailed, type ChangeCommit } from "../api/git";
import { api } from "../api/client";
import { groupByDay, relativeTime, timeOf, type NoteChange, type NoteEdit } from "../changes/model";
import type { ChangesState } from "../changes/useChanges";
import { DiffView } from "./DiffView";
import { ChevRightIcon } from "./Icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

interface Props {
  changes: ChangesState;
  onOpen: (path: string) => void;
  onVaultChanged: (path: string) => void;
}

export function ChangesView({ changes, onOpen, onVaultChanged }: Props) {
  const { page, unseen, unseenCount } = changes;
  const [older, setOlder] = useState<ChangeCommit[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [onlyAgents, setOnlyAgents] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reverting, setReverting] = useState<{ note: NoteChange; edit: NoteEdit } | null>(null);

  // The first page refreshes every minute; older pages stay, minus any
  // commit the refreshed first page now also holds.
  const commits = useMemo(() => {
    const first = page?.commits ?? [];
    const known = new Set(first.map((c) => c.sha));
    return [...first, ...older.filter((c) => !known.has(c.sha))];
  }, [page, older]);
  const groups = useMemo(() => groupByDay(commits, unseen, { onlyAgents }), [commits, unseen, onlyAgents]);
  const hasMore = olderHasMore ?? page?.hasMore ?? false;

  const loadOlder = async () => {
    const last = commits[commits.length - 1];
    if (!last) return;
    setLoadingOlder(true);
    try {
      const next = await gitApi.changes({ limit: 200, before: last.sha });
      setOlder((o) => [...o, ...next.commits]);
      setOlderHasMore(next.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  };

  const toggle = (key: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const seenAt = page?.seen ? timeLabel(page.seen.ts) : null;

  return (
    <section className="changes" aria-labelledby="changes-title">
      <header className="changes-head">
        <div className="changes-titles">
          <h1 id="changes-title">Changes</h1>
          <p className="changes-summary" aria-live="polite">
            {!changes.loaded
              ? "Loading history"
              : unseenCount > 0
                ? `${unseenCount} ${unseenCount === 1 ? "note" : "notes"} changed by agents${seenAt ? ` since ${seenAt}` : ""}`
                : seenAt
                  ? `Nothing new from agents since ${seenAt}`
                  : "Nothing new from agents today"}
          </p>
        </div>
        <div className="changes-actions">
          <button
            type="button"
            className="changes-filter"
            aria-pressed={onlyAgents}
            onClick={() => setOnlyAgents((v) => !v)}
          >
            <span className="changes-filter-box" aria-hidden="true" />
            Only agents
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={unseenCount === 0}
            onClick={() => void changes.markAllSeen()}
          >
            Mark all seen
          </button>
        </div>
      </header>

      {changes.error ? (
        <p role="alert" className="changes-error">
          Could not load history ({changes.error}).{" "}
          <button type="button" className="changes-retry" onClick={() => void changes.reload()}>
            Try again
          </button>
        </p>
      ) : null}

      {page && !page.enabled ? (
        <p className="changes-empty">
          Git history is off for this vault. Start the server with <code>GIT_AUTOCOMMIT=1</code> to record changes.
        </p>
      ) : changes.loaded && groups.length === 0 && !changes.error ? (
        <p className="changes-empty">{onlyAgents ? "No agent changes in this period." : "No changes recorded yet."}</p>
      ) : (
        <div className="changes-days">
          {groups.map((g) => (
            <section key={g.key} className="changes-day" aria-label={g.label}>
              <h2 className="changes-day-label">{g.label}</h2>
              <ul className="changes-list">
                {g.notes.map((n) => (
                  <NoteRow
                    key={n.key}
                    note={n}
                    expanded={open.has(n.key)}
                    onToggle={() => toggle(n.key)}
                    onOpen={onOpen}
                    onRevert={(edit) => setReverting({ note: n, edit })}
                  />
                ))}
              </ul>
            </section>
          ))}
          {hasMore ? (
            <button type="button" className="btn changes-more" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "Loading" : "Load older"}
            </button>
          ) : null}
        </div>
      )}

      {reverting ? (
        <RevertDialog
          note={reverting.note}
          edit={reverting.edit}
          laterEdits={laterEditsOf(commits, reverting.note.path, reverting.edit)}
          onClose={() => setReverting(null)}
          onDone={() => {
            const p = reverting.note.path;
            setReverting(null);
            void changes.reload();
            onVaultChanged(p);
          }}
        />
      ) : null}
    </section>
  );
}

function NoteRow({
  note,
  expanded,
  onToggle,
  onOpen,
  onRevert,
}: {
  note: NoteChange;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (path: string) => void;
  onRevert: (edit: NoteEdit) => void;
}) {
  const { dir, name } = splitPath(note.path);
  const deleted = note.status === "deleted";
  return (
    <li className={clsx("changes-note", note.unseen && "is-unseen", expanded && "is-open")}>
      <button type="button" className="changes-row" aria-expanded={expanded} onClick={onToggle}>
        <span className="changes-chev" aria-hidden="true">
          <ChevRightIcon />
        </span>
        <span className="changes-dot" aria-hidden="true" />
        <span className="changes-name">
          {dir ? <span className="changes-dir">{dir}/</span> : null}
          <span className={clsx("changes-file", deleted && "is-deleted")}>{name}</span>
          {note.status !== "modified" ? <span className="changes-status">{statusLabel(note)}</span> : null}
          {note.unseen ? <span className="sr-only"> (new)</span> : null}
        </span>
        <span className="changes-actors">
          {note.actors.map((a) => (
            <ActorChip key={`${a.kind}:${a.name}`} name={a.name} kind={a.kind} />
          ))}
        </span>
        <span className="changes-count">{note.edits.length === 1 ? "1 edit" : `${note.edits.length} edits`}</span>
        <span className="changes-time">{timeOf(note.lastTs)}</span>
      </button>
      {expanded ? (
        <div className="changes-detail">
          {!deleted ? (
            <button type="button" className="btn changes-open" onClick={() => onOpen(note.path)}>
              Open note
            </button>
          ) : null}
          <ol className="changes-edits">
            {note.edits.map((e) => (
              <EditRow key={e.sha} path={note.path} edit={e} onRevert={() => onRevert(e)} />
            ))}
          </ol>
        </div>
      ) : null}
    </li>
  );
}

function EditRow({ path, edit, onRevert }: { path: string; edit: NoteEdit; onRevert: () => void }) {
  const [patch, setPatch] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!showDiff || patch !== null) return;
    gitApi
      .patch(edit.sha, path, edit.oldPath)
      .then((r) => setPatch(r.patch))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [showDiff, patch, edit.sha, edit.oldPath, path]);

  return (
    <li className={clsx("changes-edit", edit.unseen && "is-unseen")}>
      <div className="changes-edit-line">
        <span className="changes-time">{timeOf(edit.ts)}</span>
        <ActorChip name={edit.actor} kind={edit.actorKind} />
        <span className="changes-edit-what">{editLabel(edit)}</span>
        <span className="changes-edit-actions">
          <button type="button" className="btn" aria-expanded={showDiff} onClick={() => setShowDiff((v) => !v)}>
            {showDiff ? "Hide diff" : "Diff"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onRevert}
            disabled={edit.status === "renamed"}
            title={edit.status === "renamed" ? "Renames cannot be reverted here. Rename the note back from the tree." : undefined}
          >
            Revert
          </button>
        </span>
      </div>
      {showDiff ? (
        <div className="changes-diff">
          {error ? (
            <p className="changes-error">Could not load the diff ({error}).</p>
          ) : patch === null ? (
            <p className="changes-empty">Loading diff</p>
          ) : (
            <DiffView patch={patch} />
          )}
        </div>
      ) : null}
    </li>
  );
}

function RevertDialog({
  note,
  edit,
  laterEdits,
  onClose,
  onDone,
}: {
  note: NoteChange;
  edit: NoteEdit;
  laterEdits: NoteEdit[];
  onClose: () => void;
  onDone: () => void;
}) {
  const created = edit.status === "added";
  const [mode, setMode] = useState<"patch" | "restore">(laterEdits.length === 0 ? "restore" : "patch");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = edit.actor;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (created) await api.deleteNote(note.path);
      else await gitApi.revert(edit.sha, note.path, mode);
      onDone();
    } catch (e) {
      if (e instanceof RevertFailed && e.code === "CONFLICT") {
        setMode("restore");
        setError("Later edits touch the same lines, so this change cannot be undone on its own. Restoring the note to before it is still possible.");
      } else if (e instanceof RevertFailed && e.code === "PENDING") {
        setError("This note has edits that are not in history yet. Try again in a few seconds.");
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Revert {who}'s change</DialogTitle>
          <DialogDescription>
            {note.path} · {relativeDay(edit.ts)} {timeOf(edit.ts)}. Everything stays in history, a revert is a new change.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="revert-note">
            <p>This change created the note. Reverting it moves the note to Trash.</p>
            {laterEdits.length > 0 ? (
              <>
                <p>
                  {laterEdits.length === 1 ? "1 later edit goes" : `${laterEdits.length} later edits go`} with it:
                </p>
                <LaterEdits edits={laterEdits} />
              </>
            ) : null}
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label="What to revert"
            className="revert-options"
            onKeyDown={(e) => {
              if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                const next = mode === "patch" ? "restore" : "patch";
                setMode(next);
                e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next === "patch" ? 0 : 1]?.focus();
              }
            }}
          >
            <RevertOption
              checked={mode === "patch"}
              onSelect={() => setMode("patch")}
              title="Undo only this change"
              body={laterEdits.length > 0 ? "Later edits stay." : "The note goes back to how it was before."}
            />
            <RevertOption
              checked={mode === "restore"}
              onSelect={() => setMode("restore")}
              title="Restore the note to before this change"
              body={
                laterEdits.length > 0
                  ? `${laterEdits.length === 1 ? "1 later edit is" : `${laterEdits.length} later edits are`} removed too:`
                  : "Nothing was changed after it."
              }
            >
              {laterEdits.length > 0 ? <LaterEdits edits={laterEdits} /> : null}
            </RevertOption>
          </div>
        )}

        {error ? (
          <p role="alert" className="changes-error">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void run()}>
            {busy ? "Reverting" : created ? "Move to Trash" : "Revert"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LaterEdits({ edits }: { edits: NoteEdit[] }) {
  return (
    <ul className="revert-later">
      {edits.map((l) => (
        <li key={l.sha}>
          <ActorChip name={l.actor} kind={l.actorKind} />{" "}
          <span className="changes-time">
            {relativeDay(l.ts)} {timeOf(l.ts)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function RevertOption({
  checked,
  onSelect,
  title,
  body,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      className={clsx("revert-option", checked && "is-checked")}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="revert-radio" aria-hidden="true" />
      <span className="revert-text">
        <span className="revert-title">{title}</span>
        <span className="revert-body">{body}</span>
        {children}
      </span>
    </div>
  );
}

export function ActorChip({ name, kind }: { name: string; kind: string }) {
  return (
    <span className={clsx("actor-chip", `is-${kind}`)} title={kind === "agent" ? `Agent: ${name}` : kind === "human" ? name : `${name}: no author recorded`}>
      {name}
    </span>
  );
}

function laterEditsOf(commits: ChangeCommit[], path: string, edit: NoteEdit): NoteEdit[] {
  const out: NoteEdit[] = [];
  for (const c of commits) {
    if (c.sha === edit.sha) break;
    const f = c.files.find((x) => x.path === path || x.oldPath === path);
    if (f) out.push({ sha: c.sha, ts: c.ts, actor: f.actor, actorKind: f.actorKind, status: f.status, unseen: false });
  }
  return out;
}

function splitPath(p: string): { dir: string; name: string } {
  const clean = p.replace(/\.md$/i, "");
  const i = clean.lastIndexOf("/");
  return i === -1 ? { dir: "", name: clean } : { dir: clean.slice(0, i), name: clean.slice(i + 1) };
}

function statusLabel(n: NoteChange): string {
  if (n.status === "added") return "new";
  if (n.status === "deleted") return "deleted";
  if (n.status === "renamed") return n.oldPath ? `renamed from ${n.oldPath.replace(/\.md$/i, "")}` : "renamed";
  return "";
}

function editLabel(e: NoteEdit): string {
  if (e.status === "added") return "created the note";
  if (e.status === "deleted") return "deleted the note";
  if (e.status === "renamed") return e.oldPath ? `renamed it from ${e.oldPath.replace(/\.md$/i, "")}` : "renamed it";
  return "edited";
}

function relativeDay(ts: number): string {
  const r = relativeTime(ts);
  return r.endsWith("ago") || r === "just now" ? "" : r;
}

function timeLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? timeOf(ts)
    : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${timeOf(ts)}`;
}
