import type { Plugin } from "unified";
import type { Root, RootContent } from "mdast";

export interface SourceposOptions {
  lineOffset: number;
}

const TARGET = new Set<RootContent["type"] | string>([
  "paragraph",
  "heading",
  "list",
  "blockquote",
  "code",
  "table",
  "thematicBreak",
  "html",
  "math",
  "footnoteDefinition",
  "definition",
]);

export const remarkSourcepos: Plugin<[SourceposOptions], Root> = function (opts) {
  return (tree) => {
    for (const child of tree.children) {
      if (!TARGET.has(child.type)) continue;
      const pos = (child as { position?: { start: { line: number } } }).position;
      const start = pos?.start.line;
      if (start === undefined) continue;
      const line = start + opts.lineOffset;
      const data = ((child as { data?: Record<string, unknown> }).data ??= {}) as Record<string, unknown>;
      const props = (data.hProperties ??= {}) as Record<string, unknown>;
      props["data-source-line"] = String(line);
    }
  };
};
