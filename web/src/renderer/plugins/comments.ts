import type { Plugin } from "unified";
import type { Root, Text, Parent, PhrasingContent } from "mdast";
import { visit, SKIP } from "unist-util-visit";

const INLINE_RE = /%%([\s\S]*?)%%/g;

export const remarkComments: Plugin<[], Root> = function () {
  return (tree) => {
    // strip inline %%...%% from text nodes
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || typeof index !== "number") return;
      const value = node.value;
      if (!value.includes("%%")) return;
      const stripped = value.replace(INLINE_RE, "");
      if (stripped === value) return;
      if (stripped === "") {
        (parent as Parent).children.splice(index, 1);
        return index;
      }
      const out: PhrasingContent[] = [{ type: "text", value: stripped }];
      (parent as Parent).children.splice(index, 1, ...out);
      return index + out.length;
    });

    // remove paragraphs whose body is entirely a multi-line comment block
    visit(tree, "paragraph", (node, index, parent) => {
      if (!parent || typeof index !== "number") return;
      const allText = node.children
        .map((c) => (c.type === "text" ? c.value : ""))
        .join("");
      if (/^\s*%%[\s\S]*?%%\s*$/.test(allText) && allText.replace(/%%[\s\S]*?%%/g, "").trim() === "") {
        (parent as Parent).children.splice(index, 1);
        return [SKIP, index];
      }
    });
  };
};
