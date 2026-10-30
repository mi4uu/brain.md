import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/renderer/render";

const opts = {
  resolveWikilink: () => "note.md",
  isMediaTarget: () => false,
  buildMediaUrl: (target: string) => `/api/media-raw/${target}`,
};

function render(md: string): string {
  return renderMarkdown(md, opts).html;
}

describe("renderMarkdown sanitisation", () => {
  test("strips onerror handler from raw img", () => {
    const html = render(`<img src="x" onerror="alert(document.cookie)">`);
    expect(html).not.toMatch(/onerror/i);
    expect(html).toContain('<img src="/api/media-raw/x">');
  });

  test("drops script tags entirely", () => {
    const html = render(`<script>alert(1)</script>`);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
  });

  test("drops javascript: hrefs", () => {
    const html = render(`<a href="javascript:alert(1)">click</a>`);
    expect(html).not.toMatch(/javascript:/i);
  });

  test("drops data:text/html hrefs", () => {
    const html = render(`<a href="data:text/html,<script>alert(1)</script>">click</a>`);
    expect(html).not.toContain("data:text/html");
  });

  test("drops iframe/object/embed/style tags", () => {
    expect(render(`<iframe src="https://evil.example"></iframe>`)).not.toContain("<iframe");
    expect(render(`<object data="evil.swf"></object>`)).not.toContain("<object");
    expect(render(`<embed src="evil.swf">`)).not.toContain("<embed");
    expect(render(`<style>body{display:none}</style>`)).not.toContain("<style");
  });

  test("drops inline event handlers on any element", () => {
    const html = render(`<div onclick="alert(1)">click me</div>`);
    expect(html).not.toMatch(/onclick/i);
    expect(html).toContain("click me");
  });

  test("keeps KaTeX output for inline and block math", () => {
    const html = render("Euler: $e^{i\\pi}+1=0$\n\n$$\\sqrt{x}$$");
    expect(html).toContain("katex");
    expect(html).toContain("<svg"); // sqrt radical glyph
  });

  test("keeps highlight.js classes on fenced code blocks", () => {
    const html = render("```ts\nconst x: number = 1;\n```");
    expect(html).toContain("hljs");
    expect(html).toContain("language-ts");
  });

  test("keeps callout markup", () => {
    const html = render("> [!note] Heads up\n> body text");
    expect(html).toContain('class="callout note"');
  });

  test("keeps wikilink and tag markup", () => {
    const html = render("See [[Other Note]] and #project");
    expect(html).toContain("wikilink");
    expect(html).toContain('class="tag"');
  });

  test("keeps mermaid block placeholder", () => {
    const html = render("```mermaid\nflowchart LR\nA --> B\n```");
    expect(html).toContain("mermaid-block");
    expect(html).toContain("data-mermaid");
  });

  test("keeps heading ids for anchor navigation", () => {
    const html = render("## Hello World");
    expect(html).toContain('id="hello-world"');
  });

  test("keeps task list checkboxes", () => {
    const html = render("- [x] done\n- [ ] todo");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });
});
