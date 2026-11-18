import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/renderer/render";

const opts = { resolveWikilink: () => null, isMediaTarget: () => false, buildMediaUrl: () => "" };

describe("[[#Heading]] links", () => {
  test("resolve to the current note when currentPath is given", () => {
    const { html } = renderMarkdown("see [[#Video script]]\n\n## Video script\n", { ...opts, currentPath: "Projects/launch.md" });
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('href="#/note/Projects/launch.md#video-script"');
    expect(html).toContain('id="video-script"');
  });

  test("stay broken without currentPath", () => {
    const { html } = renderMarkdown("see [[#Video script]]", opts);
    expect(html).toContain('class="wikilink broken"');
  });
});
