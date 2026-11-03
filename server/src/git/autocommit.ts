import { GitRepo } from "./git";
import type { Identity } from "../auth/identity";

export interface AutocommitOpts {
  debounceMs: number;
  enabled: boolean;
}

// Fallback for a mutation notified with no identity in scope (a background
// process, or a test calling notify() directly). Same author as the
// pre-identity code produced.
const FALLBACK_IDENTITY: Identity = { sub: "local", name: "brain.md", kind: "human" };

export class Autocommit {
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Keyed by path so a later write to the same path before flush replaces
  // its actor, matching who actually made the LAST change to that path.
  private pendingPaths = new Map<string, Identity>();
  private inFlight = false;
  private rerun = false;

  constructor(
    private readonly repo: GitRepo,
    public opts: AutocommitOpts,
  ) {}

  setEnabled(v: boolean) {
    this.opts = { ...this.opts, enabled: v };
    if (!v && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setDebounceMs(ms: number) {
    this.opts = { ...this.opts, debounceMs: Math.max(500, ms) };
  }

  // board-plan Part B: identity is captured HERE, at notify time (inside
  // the request that made the mutation), not at flush time (the debounce
  // timer fires outside any request, with no identity of its own).
  notify(path: string, identity?: Identity) {
    if (!this.opts.enabled) return;
    this.pendingPaths.set(path, identity ?? FALLBACK_IDENTITY);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.opts.debounceMs);
  }

  // Returns the last commit sha made (or null if nothing was dirty). A
  // single flush can produce more than one commit, see groupByActor.
  //
  // Design: snapshot pendingPaths synchronously right here, before any
  // await, then stage and commit exactly those snapshotted paths per
  // actor (never a sweeping `git add -A`). A notify() landing on a path
  // already claimed by this snapshot can't happen (that path left
  // pendingPaths the moment it was snapshotted), so there's nothing to
  // race there. A notify() for any OTHER path can land at any later await
  // in this method, including inside a group's own commit: it's simply
  // left in pendingPaths for the fallback and the next flush to respect,
  // see fallbackCommit() and the retry scheduled at the end of this
  // method.
  async flush(): Promise<string | null> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) {
      this.rerun = true;
      return null;
    }
    if (!this.opts.enabled) return null;
    if (!(await this.repo.isEnabled())) return null;

    const snapshot = new Map(this.pendingPaths);
    this.pendingPaths.clear();
    this.inFlight = true;
    let lastSha: string | null = null;
    try {
      const dirty = await this.repo.hasChanges();
      // A notify() that landed while the hasChanges() await above was in
      // flight is still sitting in pendingPaths right now (notify() only
      // clears via a flush's own snapshot). Fold it into THIS flush's
      // snapshot instead of leaving it for the zero-groups fallback below
      // to sweep up unattributed, or leaving it queued for a later flush
      // to repeat the same race against.
      if (this.pendingPaths.size > 0) {
        for (const [path, identity] of this.pendingPaths) snapshot.set(path, identity);
        this.pendingPaths.clear();
      }
      if (!dirty && snapshot.size === 0) return null;

      const groups = groupByActor(snapshot);
      let anyGroupFailed = false;
      for (const group of groups) {
        try {
          const sha = await this.repo.commitAll(commitMessage(group.paths), {
            paths: group.paths,
            author: { name: group.identity.name, email: group.identity.email ?? "agent@brain.local" },
            trailers: trailersFor(group.identity),
          });
          if (sha) lastSha = sha;
        } catch (e) {
          // A group's commit can fail for reasons --ignore-errors in
          // git.ts doesn't cover (disk full, a lock held by another
          // process). Put its paths back instead of dropping them: a
          // later flush (notify() debounce, or the retry below) gets
          // another shot instead of silently losing the change. git.ts
          // unstages this group's own paths on that failure, so the next
          // group below starts from a clean index instead of inheriting
          // this one's staged-but-uncommitted files.
          console.warn("[autocommit] group commit failed, will retry:", e);
          anyGroupFailed = true;
          for (const path of group.paths) {
            if (!this.pendingPaths.has(path)) this.pendingPaths.set(path, group.identity);
          }
        }
      }
      // Every group above staged and committed exactly its own snapshotted
      // paths, by pathspec, never a sweeping `git add -A`. Anything still
      // dirty after all of them belongs to no notified actor at all (an
      // external edit, a restart that lost pendingPaths, or a direct
      // flush() call with nothing queued, same as v0.4.12's always-commit
      // behaviour): one fallback commit for it under the default author.
      // Skipped whenever a group failed: its paths are still dirty too,
      // queued above for the retry this method schedules below, and the
      // fallback can't yet tell its dirt apart from theirs.
      if (!anyGroupFailed) {
        const sha = await this.fallbackCommit();
        if (sha) lastSha = sha;
      }
    } finally {
      this.inFlight = false;
    }
    if (this.rerun || this.pendingPaths.size > 0) {
      this.rerun = false;
      setTimeout(() => void this.flush(), 50);
    }
    return lastSha;
  }

  // Commits whatever is dirty on disk right now but claimed by no actor,
  // under the default author. Must-fix regression (f7618a5): a blanket
  // `commitAll('auto')` here (no `paths`, so it staged everything with
  // `git add -A`) could not tell an unclaimed path apart from one that
  // arrived in this.pendingPaths mid-flush, queued for its own actor's
  // commit a moment later (notify() doesn't check inFlight, so a request's
  // mutation can land at any point during this method's own awaits, or
  // during the per-group commits above). That swept the newcomer's change
  // into the fallback commit under the wrong author; its pendingPaths
  // entry then survived to be "retried" against a file already committed.
  // Re-reading the queue right here, right before staging, closes that:
  // dirtyPaths() lists every dirty path, and anything already in
  // pendingPaths is left for the flush that queued it to commit under its
  // own author, explicit pathspec, never a sweep.
  private async fallbackCommit(): Promise<string | null> {
    const dirty = await this.repo.dirtyPaths();
    const unclaimed = dirty.filter((p) => !this.pendingPaths.has(p));
    if (unclaimed.length === 0) return null;
    return this.repo.commitAll("auto", {
      paths: unclaimed,
      author: { name: FALLBACK_IDENTITY.name, email: FALLBACK_IDENTITY.email ?? "agent@brain.local" },
    });
  }
}

interface ActorGroup {
  identity: Identity;
  paths: string[];
}

// One group per distinct subject that touched a path in this flush window,
// so each actor gets their own commit (board-plan: "split into one commit
// per actor" rather than one commit crediting whoever happened to flush).
// Keyed by kind + credentialId (not just sub): a password-authenticated
// human session and an MCP client consented with that same password both
// end up with sub === LOCAL_SUB, and distinct MCP clients consented that
// way all share it too, see Identity.credentialId. Without the kind/
// credentialId split they'd merge into one commit under whichever
// identity happened to be recorded first.
function groupByActor(pendingPaths: Map<string, Identity>): ActorGroup[] {
  const byKey = new Map<string, ActorGroup>();
  for (const [path, identity] of pendingPaths) {
    const key = `${identity.kind}:${identity.credentialId ?? identity.sub}`;
    let g = byKey.get(key);
    if (!g) {
      g = { identity, paths: [] };
      byKey.set(key, g);
    }
    g.paths.push(path);
  }
  return Array.from(byKey.values());
}

function commitMessage(paths: string[]): string {
  return paths.length > 0
    ? `auto: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` +${paths.length - 3}` : ""}`
    : "auto";
}

// Agent credentials (API keys, MCP OAuth clients) get trailers recording
// who they acted for; a human (password login, or the back-compat
// unconfigured case) IS the owner, so there's nothing to say "on behalf
// of": the author line already covers it.
function trailersFor(identity: Identity): Record<string, string> | undefined {
  if (identity.kind === "human") return undefined;
  return {
    "On-Behalf-Of": identity.sub,
    Agent: identity.clientName ?? identity.name,
  };
}
