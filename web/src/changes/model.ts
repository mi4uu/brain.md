import type { ActorKind, ChangeCommit, ChangeStatus, ChangesPage } from "../api/git";

export interface NoteEdit {
  sha: string;
  ts: number;
  actor: string;
  actorKind: ActorKind;
  status: ChangeStatus;
  oldPath?: string;
  unseen: boolean;
}

export interface NoteChange {
  key: string;
  path: string;
  edits: NoteEdit[];
  lastTs: number;
  unseen: boolean;
  status: ChangeStatus;
  oldPath?: string;
  actors: Array<{ name: string; kind: ActorKind }>;
}

export interface DayGroup {
  key: string;
  label: string;
  notes: NoteChange[];
}

// With no cursor yet (first visit, or a fresh vault) only the last day of
// agent work counts as new, so the first open is not a wall of history.
const FIRST_VISIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Commits arrive newest first. Everything above the commit the owner last
// marked seen is new; when that commit is not in the loaded window (older
// than the page, or history was rewritten) fall back to its timestamp.
export function unseenShas(commits: ChangeCommit[], seen: ChangesPage["seen"], now = Date.now()): Set<string> {
  const out = new Set<string>();
  if (!seen) {
    for (const c of commits) if (c.ts > now - FIRST_VISIT_WINDOW_MS) out.add(c.sha);
    return out;
  }
  const idx = commits.findIndex((c) => c.sha === seen.sha);
  if (idx >= 0) {
    for (const c of commits.slice(0, idx)) out.add(c.sha);
    return out;
  }
  for (const c of commits) if (c.ts > seen.ts) out.add(c.sha);
  return out;
}

// Only agent changes count as new: the owner's own edits and unattributed
// disk edits are listed but never ask for attention.
export function isNew(kind: ActorKind, shaUnseen: boolean): boolean {
  return shaUnseen && kind === "agent";
}

export function groupByDay(
  commits: ChangeCommit[],
  unseen: Set<string>,
  opts: { onlyAgents: boolean; now?: Date },
): DayGroup[] {
  const now = opts.now ?? new Date();
  const days = new Map<string, DayGroup>();
  const notesByDay = new Map<string, Map<string, NoteChange>>();
  for (const c of commits) {
    const d = new Date(c.ts);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    for (const f of c.files) {
      if (opts.onlyAgents && f.actorKind !== "agent") continue;
      let group = days.get(dayKey);
      if (!group) {
        group = { key: dayKey, label: dayLabel(d, now), notes: [] };
        days.set(dayKey, group);
        notesByDay.set(dayKey, new Map());
      }
      const notes = notesByDay.get(dayKey)!;
      const edit: NoteEdit = {
        sha: c.sha,
        ts: c.ts,
        actor: f.actor,
        actorKind: f.actorKind,
        status: f.status,
        ...(f.oldPath ? { oldPath: f.oldPath } : {}),
        unseen: isNew(f.actorKind, unseen.has(c.sha)),
      };
      let note = notes.get(f.path);
      if (!note) {
        note = {
          key: `${dayKey}:${f.path}`,
          path: f.path,
          edits: [],
          lastTs: c.ts,
          unseen: false,
          status: f.status,
          ...(f.oldPath ? { oldPath: f.oldPath } : {}),
          actors: [],
        };
        notes.set(f.path, note);
        group.notes.push(note);
      }
      note.edits.push(edit);
      if (edit.unseen) note.unseen = true;
      if (!note.actors.some((a) => a.name === f.actor)) note.actors.push({ name: f.actor, kind: f.actorKind });
      // Edits are newest first, so the oldest edit of the day decides
      // whether the note was created or renamed that day.
      if (f.status === "added" || f.status === "renamed") {
        note.status = f.status;
        if (f.oldPath) note.oldPath = f.oldPath;
      }
    }
  }
  for (const [, notes] of notesByDay) {
    for (const n of notes.values()) {
      if (n.edits[0]?.status === "deleted") n.status = "deleted";
    }
  }
  return Array.from(days.values());
}

function dayLabel(d: Date, now: Date): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(now) - start(d)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function relativeTime(ts: number, now = Date.now()): string {
  const m = Math.round((now - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
