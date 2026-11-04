import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { HandoffCodeStore } from "../src/auth/handoff-codes";

const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);

describe("HandoffCodeStore", () => {
  test("issues a code that consumes to the original payload exactly once, with the right secret", () => {
    const store = new HandoffCodeStore();
    const code = store.issue("token-123", SECRET_A);
    expect(store.consume(code, SECRET_A)).toBe("token-123");
    expect(store.consume(code, SECRET_A)).toBeUndefined();
  });

  test("an unknown code consumes to undefined", () => {
    const store = new HandoffCodeStore();
    expect(store.consume("not-a-real-code", SECRET_A)).toBeUndefined();
  });

  test("codes are unique per issue", () => {
    const store = new HandoffCodeStore();
    const a = store.issue("payload-a", SECRET_A);
    const b = store.issue("payload-b", SECRET_B);
    expect(a).not.toBe(b);
    expect(store.consume(a, SECRET_A)).toBe("payload-a");
    expect(store.consume(b, SECRET_B)).toBe("payload-b");
  });

  // Login CSRF regression: a code handed to a browser that never ran the
  // flow (wrong bind secret) must not redeem, even though the code
  // itself is valid and unexpired.
  test("the wrong secret fails to consume a valid, unexpired code", () => {
    const store = new HandoffCodeStore();
    const code = store.issue("token-123", SECRET_A);
    expect(store.consume(code, SECRET_B)).toBeUndefined();
    // and the code is burned, even though the secret was wrong
    expect(store.consume(code, SECRET_A)).toBeUndefined();
  });

  describe("TTL expiry", () => {
    let nowSpy: ReturnType<typeof spyOn> | undefined;

    afterEach(() => {
      nowSpy?.mockRestore();
      nowSpy = undefined;
    });

    test("a correctly-bound code is rejected once the 60s TTL has passed", () => {
      const start = 1_700_000_000_000;
      nowSpy = spyOn(Date, "now").mockReturnValue(start);
      const store = new HandoffCodeStore();
      const code = store.issue("token-123", SECRET_A);

      nowSpy.mockReturnValue(start + 60_000 + 1);
      expect(store.consume(code, SECRET_A)).toBeUndefined();
    });

    test("a code is still valid exactly at the TTL boundary, expired 1ms past it", () => {
      // consume()'s check is `rec.expiresAt < Date.now()`, a strict "<",
      // so `now === expiresAt` is NOT yet expired; this pins that exact
      // off-by-one semantics instead of assuming `<=`.
      const start = 1_700_000_000_000;
      nowSpy = spyOn(Date, "now").mockReturnValue(start);
      const store = new HandoffCodeStore();
      const at = store.issue("at", SECRET_A);
      const past = store.issue("past", SECRET_A);

      nowSpy.mockReturnValue(start + 60_000);
      expect(store.consume(at, SECRET_A)).toBe("at");

      nowSpy.mockReturnValue(start + 60_000 + 1);
      expect(store.consume(past, SECRET_A)).toBeUndefined();
    });
  });
});
