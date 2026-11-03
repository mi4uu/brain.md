// Brute-force protection for POST /api/auth/login.
//
// Per-IP sliding window: MAX_FAILURES wrong passwords within WINDOW_MS
// blocks that IP with 429 + Retry-After, counted from the oldest failure
// still inside the window. A successful login clears that IP's history.
//
// Global backoff: a small extra delay once the whole server is seeing a
// burst of failures in a short window, regardless of which IP they came
// from — slows a botnet spreading guesses across many IPs to dodge the
// per-IP limit. It runs before password verification so it also applies
// to callers who haven't failed yet.
//
// In-memory, single process (per the task). A restart resets both limits.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_THRESHOLD = 10;
const GLOBAL_BACKOFF_STEP_MS = 50;
const GLOBAL_BACKOFF_CAP_MS = 2000;

// Sweep the per-IP map once it's grown past this many distinct IPs, so a
// distributed attempt that always fails once per IP can't grow it
// unboundedly between successful sweeps triggered by `check()`.
const SWEEP_THRESHOLD = 5000;

export interface LoginGate {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export class LoginLimiter {
  private readonly failuresByIp = new Map<string, number[]>();
  private globalFailures: number[] = [];

  check(ip: string, now: number = Date.now()): LoginGate {
    if (this.failuresByIp.size >= SWEEP_THRESHOLD) this.sweep(now);
    const list = this.pruned(this.failuresByIp.get(ip), now, WINDOW_MS);
    if (list.length === 0) {
      this.failuresByIp.delete(ip);
    } else {
      this.failuresByIp.set(ip, list);
    }
    if (list.length < MAX_FAILURES) return { allowed: true };
    const oldest = list[0] as number;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  recordFailure(ip: string, now: number = Date.now()): void {
    const list = this.pruned(this.failuresByIp.get(ip), now, WINDOW_MS);
    list.push(now);
    this.failuresByIp.set(ip, list);
    this.globalFailures = this.pruned(this.globalFailures, now, GLOBAL_WINDOW_MS);
    this.globalFailures.push(now);
  }

  recordSuccess(ip: string): void {
    this.failuresByIp.delete(ip);
  }

  // Delay proportional to how many failures the whole server just saw,
  // capped so it never turns into its own denial of service. Normal
  // traffic (under GLOBAL_THRESHOLD failures/minute) pays nothing.
  async globalBackoff(now: number = Date.now()): Promise<void> {
    this.globalFailures = this.pruned(this.globalFailures, now, GLOBAL_WINDOW_MS);
    const excess = this.globalFailures.length - GLOBAL_THRESHOLD;
    if (excess <= 0) return;
    const delay = Math.min(GLOBAL_BACKOFF_CAP_MS, excess * GLOBAL_BACKOFF_STEP_MS);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private pruned(list: number[] | undefined, now: number, windowMs: number): number[] {
    if (!list || list.length === 0) return [];
    return list.filter((t) => now - t < windowMs);
  }

  private sweep(now: number): void {
    for (const [ip, list] of this.failuresByIp) {
      const pruned = this.pruned(list, now, WINDOW_MS);
      if (pruned.length === 0) this.failuresByIp.delete(ip);
      else this.failuresByIp.set(ip, pruned);
    }
  }

  // For tests.
  trackedIpCount(): number {
    return this.failuresByIp.size;
  }
}
