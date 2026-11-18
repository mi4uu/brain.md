import { describe, expect, test } from "bun:test";
import { isAttachmentName, renderMarkdown } from "../src/renderer/render";

describe("isAttachmentName", () => {
  test("a note name with a dot and spaces is not an attachment", () => {
    expect(isAttachmentName("brain.md launch")).toBe(false);
    expect(isAttachmentName("v1.2 release notes")).toBe(false);
    expect(isAttachmentName("Release 0.6")).toBe(false);
    expect(isAttachmentName("Notes 2026.11")).toBe(false);
  });

  test("real attachments still match", () => {
    expect(isAttachmentName("report.docx")).toBe(true);
    expect(isAttachmentName("data/export.csv")).toBe(true);
    expect(isAttachmentName("backup.tar.gz")).toBe(true);
    expect(isAttachmentName("archive.7z")).toBe(true);
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
