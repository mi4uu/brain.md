import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../src/version";

// VERSION is meant to be the single source of truth the mcp server and
// web UI read (see src/version.ts's own comment). A release bump that
// only touches package.json and misses this file silently ships a stale
// version in /mcp's initialize response and the web UI, exactly what
// happened on this branch (package.json went to 0.5.0, this file stayed
// at 0.4.12). Pin them together so that drift fails the suite.
describe("VERSION", () => {
  test("matches server/package.json's version", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "../package.json"), "utf8"),
    ) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});
