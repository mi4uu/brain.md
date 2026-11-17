import { describe, expect, test } from "bun:test";
import { isAttachmentName, renderMarkdown } from "../src/renderer/render";

describe("isAttachmentName", () => {
  test("a note name with a dot and spaces is not an attachment", () => {
    expect(isAttachmentName("brain.md launch")).toBe(false);
    expect(isAttachmentName("v1.2 release notes")).toBe(false);
  });

  test("real attachments still match", () => {
    expect(isAttachmentName("report.docx")).toBe(true);
    expect(isAttachmentName("data/export.csv")).toBe(true);
    expect(isAttachmentName("photo.png")).toBe(false);
    expect(isAttachmentName("note.md")).toBe(false);
  });

  test("[[brain.md launch]] renders as a resolved wikilink", () => {
    const { html } = renderMarkdown("[[brain.md launch]]", {
      resolveWikilink: (t) => (t === "brain.md launch" ? "Projects/brain.md launch.md" : null),
      isMediaTarget: () => false,
      buildMediaUrl: () => "",
    });
    expect(html).toContain('data-resolved="Projects/brain.md launch.md"');
  });
});
