import { GitRepo } from "./git";

export interface AutocommitOpts {
  debounceMs: number;
  enabled: boolean;
}

export class Autocommit {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pendingPaths = new Set<string>();
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

  notify(path: string) {
    if (!this.opts.enabled) return;
    this.pendingPaths.add(path);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.opts.debounceMs);
  }

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
    const paths = Array.from(this.pendingPaths);
    this.pendingPaths.clear();
    this.inFlight = true;
    let sha: string | null = null;
    try {
      const dirty = await this.repo.hasChanges();
      if (!dirty) return null;
      const message = paths.length > 0
        ? `auto: ${paths.slice(0, 3).join(", ")}${paths.length > 3 ? ` +${paths.length - 3}` : ""}`
        : "auto";
      sha = await this.repo.commitAll(message);
    } finally {
      this.inFlight = false;
    }
    if (this.rerun) {
      this.rerun = false;
      setTimeout(() => void this.flush(), 50);
    }
    return sha;
  }
}
