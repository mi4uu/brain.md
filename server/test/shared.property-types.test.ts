import { expect, test } from "bun:test";
import { inferType, normalizeType, resolveType } from "@brainmd/shared/property-types";

test("infer", () => {
  expect(inferType([])).toBe("text");
  expect(inferType([null, true, false])).toBe("checkbox");
  expect(inferType([1, 2.5])).toBe("number");
  expect(inferType(["2026-11-26", "2026-01-01"])).toBe("date");
  expect(inferType(["2026-11-26", "2026-11-26T10:30"])).toBe("datetime");
  expect(inferType(["2026-11-26T10:30:00Z"])).toBe("datetime");
  expect(inferType([["a"], "b"])).toBe("multitext");
  expect(inferType([1, "a"])).toBe("text");
  expect(inferType([{ a: 1 }])).toBe("text");
  expect(normalizeType("List")).toBe("text");
  expect(normalizeType("multitext")).toBe("multitext");
});

test("resolveType", () => {
  expect(resolveType("tags", "text", "text")).toBe("tags");
  expect(resolveType("aliases", undefined, "text")).toBe("aliases");
  expect(resolveType("due", "datetime", "date")).toBe("datetime");
  expect(resolveType("due", undefined, "date")).toBe("date");
  expect(resolveType("constructor", undefined, "number")).toBe("number");
});
