import { describe, expect, test } from "bun:test";
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
});
