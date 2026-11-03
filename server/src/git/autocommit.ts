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
    const groups = groupByActor(this.pendingPaths);
    this.pendingPaths.clear();
    this.inFlight = true;
    let lastSha: string | null = null;
    try {
      const dirty = await this.repo.hasChanges();
      if (!dirty) return null;
      for (const group of groups) {
        const sha = await this.repo.commitAll(commitMessage(group.paths), {
          paths: group.paths,
          author: { name: group.identity.name, email: group.identity.email ?? "agent@brain.local" },
          trailers: trailersFor(group.identity),
        });
        if (sha) lastSha = sha;
      }
    } finally {
      this.inFlight = false;
    }
    if (this.rerun) {
      this.rerun = false;
      setTimeout(() => void this.flush(), 50);
    }
    return lastSha;
  }
}

interface ActorGroup {
  identity: Identity;
  paths: string[];
}

// One group per distinct subject that touched a path in this flush window,
// so each actor gets their own commit (board-plan: "split into one commit
// per actor" rather than one commit crediting whoever happened to flush).
function groupByActor(pendingPaths: Map<string, Identity>): ActorGroup[] {
  const bySub = new Map<string, ActorGroup>();
  for (const [path, identity] of pendingPaths) {
    let g = bySub.get(identity.sub);
    if (!g) {
      g = { identity, paths: [] };
      bySub.set(identity.sub, g);
    }
    g.paths.push(path);
  }
  return Array.from(bySub.values());
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
