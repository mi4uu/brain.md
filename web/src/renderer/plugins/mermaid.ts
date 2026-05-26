import type { Plugin } from "unified";
import type { Root, Code } from "mdast";
import { visit, SKIP } from "unist-util-visit";

export const remarkMermaid: Plugin<[], Root> = function () {
  return (tree) => {
    visit(tree, "code", (node: Code) => {
      if ((node.lang ?? "").toLowerCase() !== "mermaid") return;
      const value = node.value;
      const data = (node.data ??= {}) as Record<string, unknown>;
      data.hName = "div";
      data.hProperties = { class: "mermaid-block", "data-mermaid": value };
      data.hChildren = [];
      return SKIP;
    });
  };
};
