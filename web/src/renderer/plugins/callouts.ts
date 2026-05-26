import type { Plugin } from "unified";
import type { Root, Blockquote, Paragraph, Text } from "mdast";
import { visit, SKIP } from "unist-util-visit";

const CALLOUT_RE = /^\[!([a-zA-Z]+)\](-|\+)?(?:\s+(.*))?$/;

export const remarkCallouts: Plugin<[], Root> = function () {
  return (tree) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      if (!first || first.type !== "paragraph") return;
      const firstChild = (first as Paragraph).children[0];
      if (!firstChild || firstChild.type !== "text") return;
      const value = (firstChild as Text).value;
      const lineEnd = value.indexOf("\n");
      const firstLine = lineEnd >= 0 ? value.slice(0, lineEnd) : value;
      const m = firstLine.match(CALLOUT_RE);
      if (!m) return;
      const kind = (m[1] ?? "note").toLowerCase();
      const fold = m[2] ?? null;
      const titleInline = (m[3] ?? "").trim();
      const remainder = lineEnd >= 0 ? value.slice(lineEnd + 1) : "";
      const titleText = titleInline || kind.charAt(0).toUpperCase() + kind.slice(1);
      (firstChild as Text).value = remainder;
      if (remainder === "") {
        (first as Paragraph).children.shift();
      }
      const data = (node.data ??= {}) as Record<string, unknown>;
      data.hName = "div";
      data.hProperties = { class: `callout ${kind}${fold ? ` collapsible fold-${fold}` : ""}` };
      const titleNode = {
        type: "paragraph",
        data: { hName: "div", hProperties: { class: "callout-title" } },
        children: [{ type: "text", value: titleText }],
      };
      node.children.unshift(titleNode as unknown as never);
      return SKIP;
    });
  };
};
