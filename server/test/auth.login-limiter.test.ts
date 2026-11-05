import { describe, expect, test } from "bun:test";
import { LoginLimiter } from "../src/auth/login-limiter";

const WINDOW_MS = 15 * 60 * 1000;

describe("LoginLimiter: per-IP sliding window", () => {
  test("allows up to the failure threshold, then blocks with 429-worthy gate", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
      limiter.recordFailure("1.2.3.4", now);
    }
    const gate = limiter.check("1.2.3.4", now);
    expect(gate.allowed).toBe(false);
    expect(gate.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("retryAfterSeconds counts down to when the oldest failure ages out", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) limiter.recordFailure("1.2.3.4", now);
    const gate = limiter.check("1.2.3.4", now + WINDOW_MS - 1000);
    expect(gate.allowed).toBe(false);
    expect(gate.retryAfterSeconds).toBe(1);
  });

  test("a successful login resets the IP's failure count", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) limiter.recordFailure("1.2.3.4", now);
    expect(limiter.check("1.2.3.4", now).allowed).toBe(false);
    limiter.recordSuccess("1.2.3.4");
    expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
  });

  test("failures outside the window don't count towards the limit", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) limiter.recordFailure("1.2.3.4", now);
    const gate = limiter.check("1.2.3.4", now + WINDOW_MS + 1);
    expect(gate.allowed).toBe(true);
  });

  test("different IPs are tracked independently", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) limiter.recordFailure("1.2.3.4", now);
    expect(limiter.check("1.2.3.4", now).allowed).toBe(false);
    expect(limiter.check("5.6.7.8", now).allowed).toBe(true);
  });

  test("checking without failing doesn't itself count as a failure", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) limiter.check("1.2.3.4", now);
    expect(limiter.check("1.2.3.4", now).allowed).toBe(true);
  });
});

describe("LoginLimiter.reserve: closes the check-then-verify-then-record race", () => {
  test("only MAX_FAILURES reservations are granted before any is released", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    const reservations = Array.from({ length: 12 }, () => limiter.reserve("1.2.3.4", now));
    expect(reservations.filter((r) => r.allowed).length).toBe(5);
    expect(reservations.filter((r) => !r.allowed).length).toBe(7);
  });

  test("releasing a reservation without recording a failure frees the slot again", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    const r1 = limiter.reserve("1.2.3.4", now);
    expect(r1.allowed).toBe(true);
    r1.release();
    // The slot is free again: a 5th-in-a-row reservation still succeeds.
    for (let i = 0; i < 4; i++) limiter.reserve("1.2.3.4", now);
    expect(limiter.reserve("1.2.3.4", now).allowed).toBe(true);
  });

  test("an in-flight reservation plus recorded failures together hit the limit", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 4; i++) limiter.recordFailure("1.2.3.4", now);
    const reserved = limiter.reserve("1.2.3.4", now);
    expect(reserved.allowed).toBe(true);
    // 4 recorded + 1 reserved = 5: a 6th concurrent attempt is rejected
    // even though recordFailure() for the 5th hasn't run yet.
    expect(limiter.reserve("1.2.3.4", now).allowed).toBe(false);
  });

  test("release() is idempotent", () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    const r1 = limiter.reserve("1.2.3.4", now);
    r1.release();
    r1.release();
    for (let i = 0; i < 4; i++) limiter.reserve("1.2.3.4", now);
    expect(limiter.reserve("1.2.3.4", now).allowed).toBe(true);
  });
});

describe("LoginLimiter: global backoff", () => {
  test("no delay under the global failure threshold", async () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 9; i++) limiter.recordFailure(`10.0.0.${i}`, now);
    const start = Date.now();
    await limiter.globalBackoff(now);
    expect(Date.now() - start).toBeLessThan(30);
  });

  test("adds a delay once the global threshold is exceeded", async () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 15; i++) limiter.recordFailure(`10.0.0.${i}`, now);
    const start = Date.now();
    await limiter.globalBackoff(now);
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  });

  test("global failures older than the global window don't contribute", async () => {
    const limiter = new LoginLimiter();
    const now = 1_000_000;
    for (let i = 0; i < 15; i++) limiter.recordFailure(`10.0.0.${i}`, now);
    const start = Date.now();
    await limiter.globalBackoff(now + 61_000);
    expect(Date.now() - start).toBeLessThan(30);
  });
});
