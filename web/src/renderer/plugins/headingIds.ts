import type { Plugin } from "unified";
import type { Root, Element, Text } from "hast";
import { visit } from "unist-util-visit";

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export const rehypeHeadingIds: Plugin<[], Root> = function () {
  return (tree) => {
    const seen = new Map<string, number>();
    visit(tree, "element", (node: Element) => {
      if (!HEADINGS.has(node.tagName)) return;
      const props = (node.properties as Record<string, unknown> | undefined) ?? {};
      if (props.id) return;
      const text = collectText(node);
      const base = slug(text);
      if (!base) return;
      let id = base;
      const n = seen.get(base) ?? 0;
      if (n > 0) id = `${base}-${n}`;
      seen.set(base, n + 1);
      (node.properties as Record<string, unknown>) = { ...props, id };
    });
  };
};

function collectText(el: Element): string {
  let out = "";
  for (const c of el.children) {
    if (c.type === "text") out += (c as Text).value;
    else if (c.type === "element") out += collectText(c as Element);
  }
  return out;
}
