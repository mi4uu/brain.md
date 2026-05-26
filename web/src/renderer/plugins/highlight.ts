import type { Plugin } from "unified";
import type { Root, Text, Parent, PhrasingContent } from "mdast";
import { visit } from "unist-util-visit";

const RE = /==([^=\n][^=]*?)==/g;

interface MarkNode {
  type: "mdMark";
  value: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    mdMark: MarkNode;
  }
  interface RootContentMap {
    mdMark: MarkNode;
  }
}

export const remarkHighlight: Plugin<[], Root> = function () {
  return (tree) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || typeof index !== "number") return;
      const value = node.value;
      if (!value.includes("==")) return;
      const out: PhrasingContent[] = [];
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      const re = new RegExp(RE.source, "g");
      while ((m = re.exec(value)) !== null) {
        const text = m[1] ?? "";
        if (m.index > lastIdx) {
          out.push({ type: "text", value: value.slice(lastIdx, m.index) });
        }
        out.push({
          type: "mdMark",
          value: text,
          data: {
            hName: "mark",
            hChildren: [{ type: "text", value: text }],
          },
        } as unknown as PhrasingContent);
        lastIdx = m.index + m[0].length;
      }
      if (lastIdx === 0) return;
      if (lastIdx < value.length) {
        out.push({ type: "text", value: value.slice(lastIdx) });
      }
      (parent as Parent).children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
};
