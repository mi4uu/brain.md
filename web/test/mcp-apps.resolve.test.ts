import { describe, expect, test } from "bun:test";
import { resolveWikilinkIn } from "../src/mcp-apps/resolve";

const notes = ["work/projects/Brain.md", "private/ideas.md", "work/ideas.md"];

describe("resolveWikilinkIn", () => {
  test("matches a full path, case-insensitive, with or without .md", () => {
    expect(resolveWikilinkIn(notes, "work/ideas")).toBe("work/ideas.md");
    expect(resolveWikilinkIn(notes, "WORK/projects/brain.md")).toBe("work/projects/Brain.md");
  });

  test("falls back to the first basename match", () => {
    expect(resolveWikilinkIn(notes, "ideas")).toBe("private/ideas.md");
    expect(resolveWikilinkIn(notes, "brain")).toBe("work/projects/Brain.md");
  });

  test("returns null for unknown or empty targets", () => {
    expect(resolveWikilinkIn(notes, "nope")).toBeNull();
    expect(resolveWikilinkIn(notes, "  ")).toBeNull();
  });
});
