import type { Plugin } from "unified";
import type { Root, Text, Parent, PhrasingContent } from "mdast";
import { visit } from "unist-util-visit";

const WIKILINK_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
const DIM_RE = /^(\d+)(?:x(\d+))?$/;

interface WikilinkNode {
  type: "wikilink";
  embed: boolean;
  target: string;
  alias: string | null;
  section: string;
  width: number | null;
  height: number | null;
  data?: { hName: string; hProperties: Record<string, unknown>; hChildren?: unknown };
}

declare module "mdast" {
  interface RootContentMap {
    wikilink: WikilinkNode;
  }
  interface PhrasingContentMap {
    wikilink: WikilinkNode;
  }
}

export const remarkWikilinks: Plugin<[], Root> = function () {
  return (tree) => {
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || typeof index !== "number") return;
      const value = node.value;
      if (!value.includes("[[")) return;
      const out: PhrasingContent[] = [];
      let lastIdx = 0;
      let m: RegExpExecArray | null;
      const re = new RegExp(WIKILINK_RE.source, "g");
      while ((m = re.exec(value)) !== null) {
        const fullMatch = m[0];
        const bang = m[1] ?? "";
        const inner = (m[2] ?? "").trim();
        if (!inner) continue;
        if (m.index > lastIdx) {
          out.push({ type: "text", value: value.slice(lastIdx, m.index) });
        }
        const embed = bang === "!";
        const pipe = inner.indexOf("|");
        let target = pipe >= 0 ? inner.slice(0, pipe).trim() : inner;
        const aliasRaw = pipe >= 0 ? inner.slice(pipe + 1).trim() : null;
        const hashIdx = target.indexOf("#");
        const caretIdx = target.indexOf("^");
        let cut = target.length;
        if (hashIdx >= 0) cut = Math.min(cut, hashIdx);
        if (caretIdx >= 0) cut = Math.min(cut, caretIdx);
        const baseTarget = target.slice(0, cut);
        const section = target.slice(cut);

        let width: number | null = null;
        let height: number | null = null;
        let alias = aliasRaw;
        if (embed && aliasRaw) {
          const dm = aliasRaw.match(DIM_RE);
          if (dm) {
            width = Number(dm[1]);
            height = dm[2] ? Number(dm[2]) : null;
            alias = null;
          }
        }
        const displayAlias =
          alias ?? (section ? `${baseTarget}${section}` : null);

        out.push({
          type: "wikilink",
          embed,
          target: baseTarget,
          alias: displayAlias,
          section,
          width,
          height,
        } as unknown as PhrasingContent);
        lastIdx = m.index + fullMatch.length;
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

export type { WikilinkNode };
