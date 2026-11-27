import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/renderer/render";
import { findTableAt, type LineRange } from "../src/tables/md-table";

const opts = { resolveWikilink: () => null, isMediaTarget: () => false, buildMediaUrl: () => "" };
const TABLE = ["| a | b |", "|---|---|", "| 1 | 2 |"];
const LATER = ["", "| c | d |", "|---|---|", "| 3 | 4 |"];

function renderedTables(lines: string[]): LineRange[] {
  const { html } = renderMarkdown(`${lines.join("\n")}\n`, opts);
  return Array.from(html.matchAll(/<table data-source-line="(\d+)" data-source-end="(\d+)"/g), (m) => ({
    from: Number(m[1]),
    to: Number(m[2]),
  }));
}

// The editor rewrites every line findTableAt claims, so it must never claim a
// line the preview does not render as part of the same table.
function expectNotWider(lines: string[]) {
  const shown = renderedTables(lines);
  for (let n = 1; n <= lines.length; n++) {
    const r = findTableAt(lines, n);
    if (!r) continue;
    const owner = shown.find((s) => s.from === r.from);
    expect({ line: n, range: r, inside: !!owner && r.to <= owner.to }).toEqual({ line: n, range: r, inside: true });
  }
}

const cases: Record<string, string[]> = {
  "plain table": TABLE,
  "table after a paragraph": ["intro", ...TABLE],
  "list item after the table": [...TABLE, "- x | y"],
  "heading after the table": [...TABLE, "# h | x"],
  "quote after the table": [...TABLE, "> q | x"],
  "ordered item after the table": [...TABLE, "1. x | y"],
  "indented code after the table": [...TABLE, "    code | x"],
  "html after the table": [...TABLE, "<div>a|b</div>"],
  "header on a list item": ["- a | b", "--- | ---", "1 | 2"],
  "header on a heading": ["# a | b", "--- | ---", "1 | 2"],
  "backtick fence inside a tilde block": ["~~~", "```", ...TABLE.slice(0, 2), "~~~", ...LATER],
  "short fence inside a long one": ["````", "```", ...TABLE.slice(0, 2), "````", ...LATER],
  "fence with info string does not close": ["```", "```js", ...TABLE.slice(0, 2), "```", ...LATER],
};

describe("findTableAt agrees with the renderer", () => {
  for (const [name, lines] of Object.entries(cases)) {
    test(`${name}: never wider than the rendered table`, () => expectNotWider(lines));
  }

  test("a block-starting line after the table ends it", () => {
    for (const tail of ["- x | y", "# h | x", "> q | x", "1. x | y", "    code | x", "<div>a|b</div>"]) {
      expect(findTableAt([...TABLE, tail], 1)).toEqual({ from: 1, to: 3 });
      expect(findTableAt([...TABLE, tail], 4)).toBeNull();
    }
  });

  test("a header line that starts another block is no table", () => {
    expect(findTableAt(["- a | b", "--- | ---", "1 | 2"], 1)).toBeNull();
    expect(findTableAt(["# a | b", "--- | ---", "1 | 2"], 1)).toBeNull();
  });

  test("a fence closes only on its own marker kind and length", () => {
    for (const open of [["~~~", "```"], ["````", "```"]]) {
      const lines = [open[0]!, open[1]!, ...TABLE.slice(0, 2), open[0]!, ...LATER];
      expect(findTableAt(lines, 3)).toBeNull();
      expect(findTableAt(lines, 8)).toEqual({ from: 7, to: 9 });
    }
  });
});
