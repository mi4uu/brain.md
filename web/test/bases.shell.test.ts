import { describe, expect, test } from "bun:test";
import type { PropertyType } from "@brainmd/shared/property-types";
import { addView } from "@brainmd/shared/base-yaml";
import { fenceEdit, isLiveFence } from "../src/bases/edit";
import { optionType, partialHit, viewIndexFor } from "../src/bases/model";
import { renderMarkdown } from "../src/renderer/render";

describe("viewIndexFor", () => {
  const names = ["Table", "Board", "board"];
  test("exact match first, then case-insensitive, else 0", () => {
    expect(viewIndexFor(names, "Board")).toBe(1);
    expect(viewIndexFor(names, "board")).toBe(2);
    expect(viewIndexFor(names, "TABLE")).toBe(0);
    expect(viewIndexFor(["A", "B"], "b")).toBe(1);
    expect(viewIndexFor(names, "Missing")).toBe(0);
    expect(viewIndexFor(names, undefined)).toBe(0);
    expect(viewIndexFor([], "x")).toBe(0);
  });
});

describe("partialHit", () => {
  const row = { partial: ["note.summary", "links"] };
  test("names the partial key a change would write or unset", () => {
    expect(partialHit(row, { set: { summary: "x" } })).toBe("summary");
    expect(partialHit(row, { unset: ["links"] })).toBe("links");
    expect(partialHit(row, { set: { status: "done" }, unset: ["due"] })).toBeNull();
    expect(partialHit({}, { set: { summary: "x" } })).toBeNull();
  });
  test("file and formula columns never match a frontmatter key", () => {
    expect(partialHit({ partial: ["file.links", "formula.x"] }, { set: { links: [], x: 1 } })).toBeNull();
  });
});

describe("optionType", () => {
  const columns = [{ key: "status", type: "text" as const }, { key: "note.due", type: "date" as const }];
  const types = new Map<string, PropertyType>([["done", "checkbox"], ["due", "datetime"]]);
  test("column type, then prefix, then the registry", () => {
    expect(optionType("note.status", columns, types)).toBe("text");
    expect(optionType("due", columns, types)).toBe("date");
    expect(optionType("file.mtime", columns, types)).toBe("file");
    expect(optionType("formula.age", columns, types)).toBe("formula");
    expect(optionType("note.done", columns, types)).toBe("checkbox");
    expect(optionType("unknown", columns, types)).toBeUndefined();
  });
});

describe("forged base blocks", () => {
  const forged = '# Note\n\n<div class="base-block" data-base="views: []" data-source-line="5" data-source-end="7"></div>\n\n```base\nviews:\n  - type: table\n```\n';

  test("the sanitiser lets a hand-written placeholder through, so the shell must check it", () => {
    expect(renderMarkdown(forged, { resolveWikilink: () => null, isMediaTarget: () => false, buildMediaUrl: (t: string) => t }).html).toContain('data-base="views: []"');
  });

  test("a hand-written block is not a live fence and its fence edit is refused", () => {
    expect(isLiveFence(forged, 3, "views: []")).toBe(false);
    expect(isLiveFence(forged, 5, "views: []")).toBe(false);
    expect(fenceEdit(forged, 5, (s) => `${s}# x\n`, "views: []")).toBeNull();
  });

  test("the real fence is live, CRLF in the rendered source included", () => {
    expect(isLiveFence(forged, 5, "views:\n  - type: table")).toBe(true);
    expect(isLiveFence(forged, 5, "views:\r\n  - type: table")).toBe(true);
    expect(isLiveFence(forged, 6, "views:\n  - type: table")).toBe(false);
  });
});

describe("toolbar edits on an empty views list", () => {
  test("addView fills an empty flow list", () => {
    expect(addView("views: []\n", { type: "table", name: "Table" })).toBe("views:\n  - type: table\n    name: Table\n");
  });
});

describe("every fence the renderer turns into a view passes the hydration gate", () => {
  const opts = { resolveWikilink: () => null, isMediaTarget: () => false, buildMediaUrl: (t: string) => t };
  const unescapeAttr = (s: string) =>
    s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16))).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const shapes: Record<string, string> = {
    plain: "# T\n\n```base\nviews: []\n```\n",
    "upper-case lang": "# T\n\n```Base\nviews: []\n```\n",
    tildes: "# T\n\n~~~base\nviews: []\n~~~\n",
    "four backticks": "# T\n\n````base\nviews: []\n````\n",
    "one space indent": "# T\n\n ```base\n views: []\n ```\n",
    "three space indent": "# T\n\n   ```base\n   views: []\n   ```\n",
    "info text": "# T\n\n```base title\nviews: []\n```\n",
    "unclosed, no final newline": "# T\n\n```base\nviews: []",
    "unclosed, final newline": "# T\n\n```base\nviews: []\n",
    "unclosed, trailing blank lines": "# T\n\n```base\nviews: []\n\n\n",
    "empty body": "# T\n\n```base\n```\n",
    "body ends in a blank line": "# T\n\n```base\nviews: []\n\n```\n",
    crlf: "# T\r\n\r\n```base\r\nviews: []\r\n```\r\n",
    frontmatter: "---\na: 1\n---\n\n```base\nviews: []\n```\n",
  };
  for (const [name, md] of Object.entries(shapes)) {
    test(name, () => {
      const m = /<div class="base-block" data-base="([^"]*)" data-source-line="(\d+)"/.exec(renderMarkdown(md, opts).html);
      expect(m).not.toBeNull();
      expect(isLiveFence(md, Number(m![2]), unescapeAttr(m![1]!))).toBe(true);
    });
  }
});

describe("a base fence directly next to a table", () => {
  const opts = { resolveWikilink: () => null, isMediaTarget: () => false, buildMediaUrl: (t: string) => t };
  const ranges = (md: string) =>
    [...renderMarkdown(md, opts).html.matchAll(/<(div class="base-block"|table)[^>]*data-source-line="(\d+)"[^>]*data-source-end="(\d+)"/g)].map(
      (m) => `${m[1] === "table" ? "table" : "base"} ${m[2]}-${m[3]}`,
    );
  test("fence above, table below: both keep their ranges and the fence is live", () => {
    const md = "```base\nviews: []\n```\n|a|b|\n|-|-|\n|1|2|\n";
    expect(ranges(md)).toEqual(["base 1-3", "table 4-6"]);
    expect(isLiveFence(md, 1, "views: []")).toBe(true);
  });
  test("table above, fence below", () => {
    const md = "|a|b|\n|-|-|\n|1|2|\n```base\nviews: []\n```\n";
    expect(ranges(md)).toEqual(["table 1-3", "base 4-6"]);
    expect(isLiveFence(md, 4, "views: []")).toBe(true);
  });
});
