import type { Plugin } from "unified";
import type { Root, Element } from "hast";
import { visit } from "unist-util-visit";

const TAGS = new Set(["img", "video", "audio", "source"]);

function isExternal(src: string): boolean {
  return (
    /^[a-z][a-z0-9+\-.]*:/i.test(src) ||
    src.startsWith("/") ||
    src.startsWith("//") ||
    src.startsWith("#") ||
    src.startsWith("data:")
  );
}

export interface RelativeMediaOptions {
  buildMediaUrl: (target: string) => string;
}

export const rehypeRelativeMedia: Plugin<[RelativeMediaOptions], Root> = function (opts) {
  return (tree) => {
    visit(tree, "element", (node: Element) => {
      if (!TAGS.has(node.tagName)) return;
      const props = node.properties as Record<string, unknown> | undefined;
      if (!props) return;
      const src = props.src;
      if (typeof src !== "string" || src === "") return;
      if (isExternal(src)) return;
      props.src = opts.buildMediaUrl(src);
    });
  };
};
