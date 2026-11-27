import { describe, expect, test } from "bun:test";
import { applyEdit, fenceEdit } from "../src/bases/edit";
import { setViewSort } from "@brainmd/shared/base-yaml";

describe("fenceEdit", () => {
  const note = "# Board\n\nintro\n\n```base\nviews:\n  - type: table\n    name: T\n```\n\nafter\n";

  test("rewrites only the fence body", () => {
    const e = fenceEdit(note, 5, (src) => setViewSort(src, 0, [{ property: "file.name", direction: "ASC" }]));
    expect(e).not.toBeNull();
    expect(applyEdit(note, e!)).toBe(
      "# Board\n\nintro\n\n```base\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: file.name\n        direction: ASC\n```\n\nafter\n",
    );
  });

  test("null when no base fence opens on that line; empty edit when unchanged", () => {
    expect(fenceEdit(note, 3, (s) => s)).toBeNull();
    expect(fenceEdit(note, 5, (s) => s)).toEqual({ from: expect.any(Number), to: expect.any(Number), insert: "" });
  });

  test("a stale expected source refuses the edit", () => {
    const two = "```base\nviews:\n  - type: table\n    name: A\n```\n\n```base\nviews:\n  - type: table\n    name: B\n```\n";
    const srcA = "views:\n  - type: table\n    name: A";
    const mut = (s: string) => s + "\n# x";
    expect(fenceEdit(two, 1, mut, srcA)).not.toBeNull();
    const afterDelete = two.slice(two.indexOf("```base", 5));
    expect(fenceEdit(afterDelete, 1, mut, srcA)).toBeNull();
    expect(fenceEdit(afterDelete, 1, mut)).not.toBeNull();
  });

  test("CRLF notes keep CRLF", () => {
    const crlf = note.replace(/\n/g, "\r\n");
    const out = applyEdit(crlf, fenceEdit(crlf, 5, (s) => setViewSort(s, 0, [{ property: "a", direction: "DESC" }]))!);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain("    sort:\r\n      - property: a\r\n        direction: DESC\r\n```");
  });
});
