// Brute-force protection for POST /api/auth/login.
//
// Per-IP sliding window: MAX_FAILURES wrong passwords within WINDOW_MS
// blocks that IP with 429 + Retry-After, counted from the oldest failure
// still inside the window. A successful login clears that IP's history.
//
// Global backoff: a small extra delay once the whole server is seeing a
// burst of failures in a short window, regardless of which IP they came
// from, slows a botnet spreading guesses across many IPs to dodge the
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

export interface AttemptReservation {
  allowed: boolean;
  retryAfterSeconds?: number;
  // No-op when `allowed` is false. Always call this once the attempt is
  // done (success, failure, or abandoned), in a finally, or the slot
  // stays reserved forever.
  release(): void;
}

export class LoginLimiter {
  private readonly failuresByIp = new Map<string, number[]>();
  // Attempts that passed `check()` and are currently verifying, keyed by
  // IP. Counted alongside recorded failures so a burst of concurrent
  // attempts can't all pass the gate before any of them calls
  // recordFailure(), see `reserve()`.
  private readonly inFlightByIp = new Map<string, number>();
  private globalFailures: number[] = [];

  check(ip: string, now: number = Date.now()): LoginGate {
    const count = this.activeFailureCount(ip, now) + (this.inFlightByIp.get(ip) ?? 0);
    if (count < MAX_FAILURES) return { allowed: true };
    const list = this.failuresByIp.get(ip) ?? [];
    const oldest = list[0];
    const retryAfterSeconds =
      oldest === undefined ? 1 : Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  // Atomically checks the gate and, if it passes, reserves a slot for
  // the attempt before the caller awaits password verification. This
  // closes the race check() alone leaves open: without a synchronous
  // reservation, N concurrent requests from the same IP can all observe
  // "under the limit", all get verified, and only afterwards call
  // recordFailure() N times, well past the limit by the time any of them
  // lands. Reserving the slot here, synchronously, means the (N+1)th
  // concurrent attempt sees the reservation and is rejected immediately,
  // never reaching password verification at all.
  reserve(ip: string, now: number = Date.now()): AttemptReservation {
    const gate = this.check(ip, now);
    if (!gate.allowed) {
      return { allowed: false, retryAfterSeconds: gate.retryAfterSeconds, release: () => {} };
    }
    this.inFlightByIp.set(ip, (this.inFlightByIp.get(ip) ?? 0) + 1);
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (released) return;
        released = true;
        const cur = this.inFlightByIp.get(ip) ?? 0;
        if (cur <= 1) this.inFlightByIp.delete(ip);
        else this.inFlightByIp.set(ip, cur - 1);
      },
    };
  }

  private activeFailureCount(ip: string, now: number): number {
    if (this.failuresByIp.size >= SWEEP_THRESHOLD) this.sweep(now);
    const list = this.pruned(this.failuresByIp.get(ip), now, WINDOW_MS);
    if (list.length === 0) {
      this.failuresByIp.delete(ip);
    } else {
      this.failuresByIp.set(ip, list);
    }
    return list.length;
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
