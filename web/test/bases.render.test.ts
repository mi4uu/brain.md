import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/renderer/render";

const opts = {
  resolveWikilink: () => null,
  isMediaTarget: () => false,
  buildMediaUrl: (t: string) => `/api/media-raw/${t}`,
};
const html = (md: string) => renderMarkdown(md, opts).html;

const YAML = 'views:\n  - type: table\n    name: "T & <b>"\n';

describe("```base fences", () => {
  test("become a placeholder with the YAML and the line range", () => {
    const out = html(`# Hi\n\n\`\`\`base\n${YAML}\`\`\`\n\nafter\n`);
    expect(out).toContain('class="base-block"');
    expect(out).toContain('data-source-line="3"');
    expect(out).toContain('data-source-end="7"');
    expect(out).toContain('data-base="views:\n  - type: table\n    name: &#x22;T &#x26; <b>&#x22;"');
    expect(out).not.toContain("<script");
  });

  test("line numbers include the frontmatter", () => {
    const out = html(`---\ntitle: x\n---\n\n\`\`\`base\nviews: []\n\`\`\`\n`);
    expect(out).toContain('data-source-line="5"');
    expect(out).toContain('data-source-end="7"');
  });

  test("the YAML stays readable inside the placeholder", () => {
    const out = html("```base\nviews: []\n```\n");
    expect(out).toContain('<pre class="base-fallback"><code class="nohighlight">views: []</code></pre>');
  });

  test("the language tag is case-insensitive; other fences and nested ones are untouched", () => {
    expect(html("```BASE\nviews: []\n```\n")).toContain("base-block");
    expect(html("```yaml\nviews: []\n```\n")).not.toContain("base-block");
    expect(html("> ```base\n> views: []\n> ```\n")).not.toContain("base-block");
    expect(html("- item\n\n  ```base\n  views: []\n  ```\n")).not.toContain("base-block");
  });

  test("a hostile YAML body cannot add attributes or elements", () => {
    const out = html('```base\n" onmouseover="alert(1)" x="\n<img src=x onerror=alert(1)>\n```\n');
    const outsideAttr = out.replace(/data-base="[^"]*"/, "");
    expect(outsideAttr).not.toMatch(/<img|<[a-z][^>]*\son\w+=/i);
    expect(out.match(/<div/g)).toHaveLength(1);
  });
});
