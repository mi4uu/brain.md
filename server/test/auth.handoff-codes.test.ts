import { describe, expect, test } from "bun:test";
import { HandoffCodeStore } from "../src/auth/handoff-codes";

describe("HandoffCodeStore", () => {
  test("issues a code that consumes to the original payload exactly once", () => {
    const store = new HandoffCodeStore();
    const code = store.issue("token-123");
    expect(store.consume(code)).toBe("token-123");
    expect(store.consume(code)).toBeUndefined();
  });

  test("an unknown code consumes to undefined", () => {
    const store = new HandoffCodeStore();
    expect(store.consume("not-a-real-code")).toBeUndefined();
  });

  test("codes are unique per issue", () => {
    const store = new HandoffCodeStore();
    const a = store.issue("payload-a");
    const b = store.issue("payload-b");
    expect(a).not.toBe(b);
    expect(store.consume(a)).toBe("payload-a");
    expect(store.consume(b)).toBe("payload-b");
  });
});
