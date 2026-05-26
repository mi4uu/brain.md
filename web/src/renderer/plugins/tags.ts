import type { Plugin } from "unified";
import type { Root, Text, Parent, PhrasingContent } from "mdast";
import { visit } from "unist-util-visit";

const TAG_RE = /(^|[\s.,;:!?(){}\[\]])#([A-Za-z0-9_][A-Za-z0-9_\-\/]*)/g;

interface TagNode {
  type: "tag";
  name: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    tag: TagNode;
  }
  interface RootContentMap {
    tag: TagNode;
  }
}

export const remarkTags: Plugin<[], Root> = function () {
  return (tree) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || typeof index !== "number") return;
      const value = node.value;
      if (!value.includes("#")) return;
      const out: PhrasingContent[] = [];
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      const re = new RegExp(TAG_RE.source, "g");
      while ((m = re.exec(value)) !== null) {
        const lead = m[1] ?? "";
        const name = m[2] ?? "";
        const startIdx = m.index + lead.length;
        if (startIdx > lastIdx) {
          out.push({ type: "text", value: value.slice(lastIdx, startIdx) });
        }
        out.push({ type: "tag", name } as unknown as PhrasingContent);
        lastIdx = startIdx + 1 + name.length;
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
