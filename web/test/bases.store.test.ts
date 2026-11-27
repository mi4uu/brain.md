import { describe, expect, test } from "bun:test";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";
import { blockKey, emitBaseRefresh, getActiveView, getCached, getLast, getOpenTool, onBaseRefresh, setActiveView, setCached, setOpenTool } from "../src/bases/store";

const res = (view: string): BaseQueryResponse => ({ views: [], view, columns: [], groups: [], total: 0, warnings: [] });

describe("base store", () => {
  test("active view and cache survive a remount, and only for the same fingerprint", () => {
    const k = blockKey("a.md", 0);
    expect(k).toBe("a.md#0");
    expect(getActiveView(k)).toBeUndefined();
    setActiveView(k, "Board");
    expect(getActiveView(k)).toBe("Board");
    setCached(k, "f1", res("Board"));
    expect(getCached(k, "f1")?.view).toBe("Board");
    expect(getCached(k, "f2")).toBeUndefined();
  });

  test("the last result is kept whatever the fingerprint, and the open popover is remembered", () => {
    const k = blockKey("b.md", 1);
    setCached(k, "old", res("A"));
    expect(getCached(k, "new")).toBeUndefined();
    expect(getLast(k)?.view).toBe("A");
    expect(getOpenTool(k)).toBeNull();
    setOpenTool(k, "filter");
    expect(getOpenTool(k)).toBe("filter");
    setOpenTool(k, null);
    expect(getOpenTool(k)).toBeNull();
  });

  test("cache is bounded", () => {
    for (let i = 0; i < 60; i++) setCached(`n${i}.md#0`, "f", res("x"));
    expect(getCached("n0.md#0", "f")).toBeUndefined();
    expect(getCached("n59.md#0", "f")).toBeDefined();
  });

  test("active view and open tool maps are bounded", () => {
    for (let i = 0; i < 300; i++) {
      setActiveView(`m${i}.md#0`, "V");
      setOpenTool(`m${i}.md#0`, "sort");
    }
    expect(getActiveView("m0.md#0")).toBeUndefined();
    expect(getOpenTool("m0.md#0")).toBeNull();
    expect(getActiveView("m299.md#0")).toBe("V");
    expect(getOpenTool("m299.md#0")).toBe("sort");
  });

  test("refresh listeners", () => {
    let n = 0;
    const off = onBaseRefresh(() => n++);
    emitBaseRefresh();
    off();
    emitBaseRefresh();
    expect(n).toBe(1);
  });
});
