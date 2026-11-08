import type { GitRepo, CommitTrailer } from "./git";
import type { Identity } from "../auth/identity";

export interface AutocommitOpts {
  debounceMs: number;
  enabled: boolean;
}

// Fallback for a mutation notified with no identity in scope (a background
// process, or a test calling notify() directly). Same author as the
// pre-identity code produced.
const FALLBACK_IDENTITY: Identity = { sub: "local", name: "brain.md", kind: "human" };

// A failed flush retries on a fixed delay, but not forever: a path that is
// persistently uncommittable (e.g. a permissions error, or the test
// directory itself having been removed) must not wedge a live setTimeout
// forever, which keeps the process' event loop non-idle and never lets it
// exit. See the module comment on Autocommit.flush() for the incident this
// closes.
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 50;

// Design: one commit per flush(), not one commit per actor.
//
// An earlier version split a flush window into one commit per distinct
// actor that touched a path in it, built through a private isolated git
// index so the actors' commits wouldn't step on each other's staged
// content, with a "reconcile the real index afterwards" step and its own
// retry-and-queue machinery. That needed four rounds of race-closing fixes
// (excludeIfClaimed rechecked at three separate points, a real-index
// reconcile with its own retry) and still had an open one: flush()'s own
// retry at the bottom of this file was an unbounded, un-cancellable,
// un-awaited `setTimeout`. If a commit kept failing the same way forever
// (e.g. the test directory it points at no longer exists, see dispose()
// below), the retry rescheduled itself every 50ms forever, which keeps
// Bun's event loop non-idle: a test run can print a clean final pass/fail
// summary and then just sit there, still forking `git` every ~50ms,
// because nothing ever cancels that chain.
//
// One commit per flush removes the reason for all of it: there is only
// ever one `git add` + one `git commit` in flight per flush, already
// serialized by GitRepo itself (see git.ts), so there is nothing for a
// second actor's commit to race. When every path in the flush came from
// the same actor, that actor is the author, same as before. When paths
// came from more than one actor, the commit is attributed to the owner
// (the pre-identity default author), with one "Changed-by: <path> <actor>"
// trailer line per path, naming exactly who touched what. That keeps a
// complete, path-level audit trail (arguably easier to grep than hunting
// across several commits for one flush) without needing an isolated index
// or a real-index reconcile step at all.
export class Autocommit {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  // Keyed by path so a later write to the same path before flush replaces
  // its actor, matching who actually made the LAST change to that path.
  private pendingPaths = new Map<string, Identity>();
  private inFlight = false;
  private rerun = false;
  private retryCount = 0;
  private disposed = false;

  constructor(
    private readonly repo: GitRepo,
    public opts: AutocommitOpts,
  ) {}

  setEnabled(v: boolean) {
    this.opts = { ...this.opts, enabled: v };
    if (!v) this.clearTimers();
  }

  setDebounceMs(ms: number) {
    this.opts = { ...this.opts, debounceMs: Math.max(500, ms) };
  }

  private clearTimers() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // Stops this instance for good: cancels the debounce timer and any
  // pending retry, and makes every later notify()/flush() a no-op.
  // Must be called by test teardown (`afterEach`) before the test's own
  // temp directory is removed, so a retry scheduled against a now-deleted
  // directory can't keep firing after the test that owned it has ended.
  // Nothing in production currently calls this (the server process holds
  // one Autocommit for its whole lifetime), but the same guarantee matters
  // there too: a persistently uncommittable path must stop retrying
  // instead of wedging the event loop forever, which MAX_RETRIES above
  // already bounds even without an explicit dispose() call.
  dispose() {
    this.disposed = true;
    this.clearTimers();
  }

  // board-plan Part B: identity is captured HERE, at notify time (inside
  // the request that made the mutation), not at flush time (the debounce
  // timer fires outside any request, with no identity of its own).
  notify(path: string, identity?: Identity) {
    if (this.disposed || !this.opts.enabled) return;
    this.pendingPaths.set(path, identity ?? FALLBACK_IDENTITY);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.opts.debounceMs);
  }

  // Returns the commit sha made (or null if nothing was dirty).
  //
  // Design: snapshot pendingPaths synchronously right here, before any
  // await, then stage and commit exactly those snapshotted paths in one
  // commit (never a sweeping `git add -A` for the whole vault). A
  // notify() landing on a path already claimed by this snapshot can't
  // happen (that path left pendingPaths the moment it was snapshotted),
  // so there's nothing to race there. A notify() for any OTHER path can
  // land at any later await in this method: it's simply left in
  // pendingPaths for the retry/next flush to pick up, see the scheduling
  // at the end of this method.
  async flush(): Promise<string | null> {
    if (this.disposed) return null;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
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
    let sha: string | null = null;
    let failed = false;
    try {
      const dirty = await this.repo.hasChanges();
      // A notify() that landed while the hasChanges() await above was in
      // flight is still sitting in pendingPaths right now (notify() only
      // clears via a flush's own snapshot). Fold it into THIS flush's
      // snapshot instead of leaving the fallback-author case below to
      // sweep it up unattributed.
      if (this.pendingPaths.size > 0) {
        for (const [path, identity] of this.pendingPaths) snapshot.set(path, identity);
        this.pendingPaths.clear();
      }

      // Regression (v0.4.12): flush() must still commit a dirty repo even
      // with nothing queued (an external edit, a restart that lost
      // pendingPaths, or a direct flush() call), but only the paths that
      // are ACTUALLY dirty, scoped by pathspec, never a blanket `git add
      // -A` that would also sweep in anything a notified actor is still
      // mid-write on.
      const paths = new Set(snapshot.keys());
      if (dirty) {
        for (const p of await this.repo.dirtyPaths()) {
          if (!snapshot.has(p)) paths.add(p);
        }
      }
      // Nothing to commit, but still fall through to the end-of-function
      // rerun/retry check below instead of returning early: a second
      // caller (e.g. a forced /api/git/flush while this flush was
      // already in-flight) may have set `this.rerun` or queued more
      // paths while this flush ran, and that request must not be
      // dropped just because THIS flush's path set happened to be empty.
      if (paths.size !== 0) {
        const { author, trailers } = describeCommit(snapshot, paths);
        try {
          sha = await this.repo.commitAll(commitMessage(Array.from(paths)), {
            paths: Array.from(paths),
            author,
            trailers,
          });
        } catch (e) {
          // A transient commit failure (a lock held by another process, a
          // rejecting hook) must not drop these paths: put them back for a
          // later flush (notify()'s own debounce, or the bounded retry
          // below) to try again, instead of silently losing the change.
          console.warn("[autocommit] commit failed, will retry:", e);
          failed = true;
          for (const [path, identity] of snapshot) {
            if (!this.pendingPaths.has(path)) this.pendingPaths.set(path, identity);
          }
        }
      }
    } finally {
      this.inFlight = false;
    }

    if (failed) {
      this.retryCount++;
      if (this.retryCount > MAX_RETRIES) {
        console.warn(
          `[autocommit] giving up after ${MAX_RETRIES} retries, ${this.pendingPaths.size} path(s) left pending; ` +
            "they'll be picked up by the next notify()'d write or an explicit flush().",
        );
        return null;
      }
      this.retryTimer = setTimeout(() => void this.flush(), RETRY_DELAY_MS);
      return null;
    }
    this.retryCount = 0;
    if (this.rerun || this.pendingPaths.size > 0) {
      this.rerun = false;
      this.retryTimer = setTimeout(() => void this.flush(), RETRY_DELAY_MS);
    }
    return sha;
  }
}

// One combined commit per flush: if every path actually committed came
// from the same actor (by kind + credentialId, see the note below), that
// actor is the author and there's nothing more to say. Otherwise the
// commit is attributed to the owner (whichever human touched this flush,
// there is only ever one per vault; the hardcoded local fallback if no
// human did), with one "Changed-by: <path> <actor>" trailer per path so
// the audit trail still names exactly who touched what, without needing a
// commit per actor.
//
// `paths` is the full committed set, which can be wider than
// `pendingPaths`: a path dirtyPaths() picked up that nobody notify()'d
// (see flush() above). Each such path gets its own actor key, keyed by
// the path itself, so it can never silently merge into the one known
// actor's identity and skip the Changed-by trailer that would otherwise
// be the only record that nobody claimed it.
//
// Grouped by kind + credentialId (not just sub): a password-authenticated
// human session and an MCP client consented with that same password both
// end up with sub === LOCAL_SUB, and distinct MCP clients consented that
// way all share it too, see Identity.credentialId. Comparing sub alone
// would merge all of them into "one actor" and lose the distinction this
// trailer exists to preserve.
function describeCommit(
  pendingPaths: Map<string, Identity>,
  paths: Set<string>,
): { author?: { name: string; email: string }; trailers?: CommitTrailer[] } {
  const actorKey = (path: string, id: Identity) =>
    pendingPaths.has(path) ? `${id.kind}:${id.credentialId ?? id.sub}` : `unattributed:${path}`;
  const distinctActors = new Set(
    Array.from(paths, (p) => actorKey(p, pendingPaths.get(p) ?? FALLBACK_IDENTITY)),
  );

  if (distinctActors.size <= 1) {
    const identity = pendingPaths.values().next().value as Identity | undefined;
    if (!identity) return {};
    return singleActorCommitOpts(identity);
  }

  const trailers: CommitTrailer[] = [];
  for (const path of paths) {
    const identity = pendingPaths.get(path) ?? FALLBACK_IDENTITY;
    trailers.push({ key: "Changed-by", value: `${path} ${actorDescription(identity)}` });
  }
  const owner = Array.from(pendingPaths.values()).find((id) => id.kind === "human") ?? FALLBACK_IDENTITY;
  return {
    author: { name: owner.name, email: owner.email ?? "agent@brain.local" },
    trailers,
  };
}

// Shared with other single-identity commit sites (e.g. the /restore API
// route) so a commit made by one known actor always gets the same
// author/trailer shape, instead of git.ts routes re-deriving it by hand.
export function singleActorCommitOpts(
  identity: Identity,
): { author: { name: string; email: string }; trailers?: CommitTrailer[] } {
  return {
    author: { name: identity.name, email: identity.email ?? "agent@brain.local" },
    trailers: trailersFor(identity),
  };
}

function actorDescription(identity: Identity): string {
  return identity.kind === "human" ? identity.name : (identity.clientName ?? identity.name);
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
function trailersFor(identity: Identity): CommitTrailer[] | undefined {
  if (identity.kind === "human") return undefined;
  return [
    { key: "On-Behalf-Of", value: identity.sub },
    { key: "Agent", value: identity.clientName ?? identity.name },
  ];
}
