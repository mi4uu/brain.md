import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/renderer/render";

const opts = { resolveWikilink: () => null, isMediaTarget: () => false, buildMediaUrl: () => "" };
const TABLE = "| a | b |\n|---|---|\n| 1 | 2 |\n";

describe("table source range", () => {
  test("a top-level table carries first and last line", () => {
    const { html } = renderMarkdown(`intro\n\n${TABLE}\nafter\n`, opts);
    expect(html).toContain('<table data-source-line="3" data-source-end="5">');
  });

  test("frontmatter lines are counted", () => {
    const { html } = renderMarkdown(`---\ntitle: x\n---\n\n${TABLE}`, opts);
    expect(html).toContain('data-source-line="5" data-source-end="7"');
  });

  test("CRLF content gives the same range", () => {
    const { html } = renderMarkdown(`intro\r\n\r\n${TABLE.replace(/\n/g, "\r\n")}`, opts);
    expect(html).toContain('data-source-line="3" data-source-end="5"');
  });

  test("the sanitizer keeps both attributes", () => {
    const { html } = renderMarkdown(TABLE, opts);
    expect(html).toMatch(/<table[^>]*data-source-end="3"/);
  });

  test("other blocks get no data-source-end", () => {
    const { html } = renderMarkdown("# h\n\npara\n", opts);
    expect(html).not.toContain("data-source-end");
  });

  test("tables nested in a blockquote are untagged", () => {
    const { html } = renderMarkdown("> | a |\n> |---|\n> | 1 |\n", opts);
    expect(html).toContain("<table>");
  });
});
