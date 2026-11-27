import type { Plugin } from "unified";
import type { Root, RootContent } from "mdast";

export interface BaseBlockOptions {
  lineOffset: number;
  // Embeds and the MCP note view render another note's HTML into their own
  // page; there the line numbers would point into the wrong note.
  enabled?: boolean;
}

// A ```base fence becomes a placeholder that Preview hydrates into a live
// view. Only top-level fences: the view writes its edits back by line range,
// which is only reliable for blocks that are direct children of the note.
// The YAML also stays inside as a code block, so a render that never
// hydrates (an embed, a copy) still shows something readable.
export const remarkBaseBlock: Plugin<[BaseBlockOptions], Root> = (opts) => (tree) => {
  if (opts.enabled === false) return;
  tree.children.forEach((node, i) => {
    if (node.type !== "code" || (node.lang ?? "").toLowerCase() !== "base" || !node.position) return;
    // A custom node type, not hName on the code node: remark-rehype would
    // keep the <pre> it wraps every code block in. mdast has no type for it,
    // hence the cast.
    tree.children[i] = {
      type: "baseBlock",
      position: node.position,
      data: {
        hName: "div",
        hProperties: {
          class: "base-block",
          "data-base": node.value,
          "data-source-line": String(node.position.start.line + opts.lineOffset),
          "data-source-end": String(node.position.end.line + opts.lineOffset),
        },
        hChildren: [
          {
            type: "element",
            tagName: "pre",
            properties: { className: ["base-fallback"] },
            children: [
              {
                type: "element",
                tagName: "code",
                properties: { className: ["nohighlight"] },
                children: [{ type: "text", value: node.value }],
              },
            ],
          },
        ],
      },
    } as unknown as RootContent;
  });
};
