import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { parse as parseYaml } from "yaml";
import { remarkWikilinks } from "./plugins/wikilinks";
import { remarkTags } from "./plugins/tags";
import { remarkCallouts } from "./plugins/callouts";
import { remarkMermaid } from "./plugins/mermaid";
import { remarkSourcepos } from "./plugins/sourcepos";
import { remarkHighlight } from "./plugins/highlight";
import { remarkComments } from "./plugins/comments";
import { rehypeRelativeMedia } from "./plugins/relativeMedia";
import { rehypeHeadingIds } from "./plugins/headingIds";
import type { Plugin } from "unified";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface FrontmatterParse {
  data: Record<string, unknown> | null;
  error: string | null;
  body: string;
  lineOffset: number;
}

function countLines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

export function splitFrontmatter(content: string): FrontmatterParse {
  const m = content.match(FM_RE);
  if (!m) return { data: null, error: null, body: content, lineOffset: 0 };
  const raw = m[1] ?? "";
  const lineOffset = countLines(m[0]);
  try {
    const parsed = parseYaml(raw);
    if (parsed === null || parsed === undefined) {
      return { data: {}, error: null, body: content.slice(m[0].length), lineOffset };
    }
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { data: null, error: "frontmatter must be YAML mapping", body: content.slice(m[0].length), lineOffset };
    }
    return {
      data: parsed as Record<string, unknown>,
      error: null,
      body: content.slice(m[0].length),
      lineOffset,
    };
  } catch (e) {
    return {
      data: null,
      error: e instanceof Error ? e.message : String(e),
      body: content.slice(m[0].length),
      lineOffset,
    };
  }
}

export interface RenderOptions {
  resolveWikilink: (target: string) => string | null;
  isMediaTarget: (target: string) => boolean;
  buildMediaUrl: (target: string) => string;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

const remarkWikilinkToHast: Plugin<[RenderOptions], Root> = function (opts) {
  return (tree) => {
    visit(tree, "wikilink", (node) => {
      const n = node as unknown as {
        target: string;
        alias: string | null;
        embed: boolean;
        section: string;
        width: number | null;
        height: number | null;
        data?: Record<string, unknown>;
      };
      const display = n.alias ?? n.target;
      const isMedia = opts.isMediaTarget(n.target);
      const isAttach = !isMedia && isAttachmentName(n.target);
      const resolved = isMedia || isAttach ? null : opts.resolveWikilink(n.target);
      const data = (n.data ??= {});

      if (isAttach) {
        const url = opts.buildMediaUrl(n.target);
        const name = n.target.split("/").pop() ?? n.target;
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        if (n.embed) {
          data.hName = "a";
          data.hProperties = {
            class: "attachment",
            href: url,
            download: name,
            "data-attachment": n.target,
            "data-attachment-ext": ext,
          };
          data.hChildren = [
            {
              type: "element",
              tagName: "span",
              properties: { class: "attachment-icon", "aria-hidden": "true" },
              children: [{ type: "text", value: iconForExt(ext) }],
            },
            {
              type: "element",
              tagName: "span",
              properties: { class: "attachment-name" },
              children: [{ type: "text", value: display }],
            },
            {
              type: "element",
              tagName: "span",
              properties: { class: "attachment-action", "aria-hidden": "true" },
              children: [{ type: "text", value: "↓" }],
            },
          ];
        } else {
          data.hName = "a";
          data.hProperties = {
            class: "attachment-link",
            href: url,
            download: name,
            "data-attachment": n.target,
            "data-attachment-ext": ext,
          };
          data.hChildren = [{ type: "text", value: display }];
        }
        return;
      }

      if (n.embed && isMedia) {
        const url = opts.buildMediaUrl(n.target);
        const ext = n.target.split(".").pop()?.toLowerCase() ?? "";
        const dims: Record<string, unknown> = {};
        if (n.width !== null) dims.width = n.width;
        if (n.height !== null) dims.height = n.height;
        if (["mp4", "webm", "mov"].includes(ext)) {
          data.hName = "video";
          data.hProperties = { src: url, controls: true, ...dims };
          data.hChildren = [];
        } else if (["mp3", "wav", "ogg"].includes(ext)) {
          data.hName = "audio";
          data.hProperties = { src: url, controls: true };
          data.hChildren = [];
        } else {
          data.hName = "img";
          data.hProperties = { src: url, alt: display, loading: "lazy", ...dims };
          data.hChildren = [];
        }
        return;
      }

      if (n.embed) {
        const path = resolved ?? "";
        const cls = resolved ? "embed-note collapsed" : "embed-note broken";
        data.hName = "div";
        data.hProperties = {
          class: cls,
          "data-target": n.target,
          "data-embed-path": path,
        };
        const header = {
          type: "element",
          tagName: "header",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "button",
              properties: { type: "button", class: "embed-toggle", "aria-label": "Toggle embed" },
              children: [
                {
                  type: "element",
                  tagName: "svg",
                  properties: {
                    width: 12,
                    height: 12,
                    viewBox: "0 0 24 24",
                    fill: "none",
                    stroke: "currentColor",
                    strokeWidth: 2,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  },
                  children: [
                    {
                      type: "element",
                      tagName: "polyline",
                      properties: { points: "9 6 15 12 9 18" },
                      children: [],
                    },
                  ],
                },
              ],
            },
            {
              type: "element",
              tagName: "a",
              properties: resolved
                ? { href: `#/note/${encodeURI(resolved)}`, "data-resolved": resolved, "data-wikilink": n.target }
                : { href: "#" },
              children: [{ type: "text", value: display }],
            },
          ],
        };
        const body = {
          type: "element",
          tagName: "div",
          properties: { class: "embed-body" },
          children: resolved
            ? [{ type: "text", value: "Loading…" }]
            : [{ type: "text", value: "Note not found." }],
        };
        data.hChildren = [header, body];
        return;
      }

      const cls = resolved ? "wikilink" : "wikilink broken";
      let fragment = "";
      if (n.section.startsWith("#")) fragment = `#${slug(n.section.slice(1))}`;
      data.hName = "a";
      data.hProperties = {
        class: cls,
        href: resolved ? `#/note/${encodeURI(resolved)}${fragment}` : "#",
        "data-wikilink": n.target,
        "data-resolved": resolved ?? "",
        "data-section": n.section || "",
      };
      data.hChildren = [{ type: "text", value: display }];
    });
  };
};

const remarkTagToHast: Plugin<[], Root> = function () {
  return (tree) => {
    visit(tree, "tag", (node) => {
      const n = node as unknown as { name: string; data?: Record<string, unknown> };
      const data = (n.data ??= {});
      data.hName = "a";
      data.hProperties = {
        class: "tag",
        href: `#/tag/${encodeURIComponent(n.name)}`,
        "data-tag": n.name,
      };
      data.hChildren = [{ type: "text", value: `#${n.name}` }];
    });
  };
};

export function renderMarkdown(content: string, opts: RenderOptions): {
  html: string;
  frontmatter: Record<string, unknown> | null;
  frontmatterError: string | null;
} {
  const { data, error, body, lineOffset } = splitFrontmatter(content);
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkComments)
    .use(remarkHighlight)
    .use(remarkCallouts)
    .use(remarkMermaid)
    .use(remarkWikilinks)
    .use(remarkTags)
    .use(remarkSourcepos, { lineOffset })
    .use(remarkWikilinkToHast, opts)
    .use(remarkTagToHast)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeRelativeMedia, { buildMediaUrl: opts.buildMediaUrl })
    .use(rehypeHeadingIds)
    .use(rehypeHighlight, { detect: true, ignoreMissing: true })
    .use(rehypeKatex)
    .use(rehypeStringify, { allowDangerousHtml: true });

  const file = processor.processSync(body);
  return { html: String(file), frontmatter: data, frontmatterError: error };
}

const MEDIA_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "mp4",
  "webm",
  "mov",
  "mp3",
  "wav",
  "ogg",
  "pdf",
]);

export function isMediaName(name: string): boolean {
  const ext = name.split(".").pop()?.toLowerCase();
  return !!ext && MEDIA_EXT.has(ext);
}

export function isAttachmentName(name: string): boolean {
  const last = name.split("/").pop() ?? name;
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = last.slice(dot + 1).toLowerCase();
  if (!ext || ext === "md") return false;
  return !MEDIA_EXT.has(ext);
}

function iconForExt(ext: string): string {
  if (["json", "yaml", "yml", "toml", "xml"].includes(ext)) return "{ }";
  if (["zip", "tar", "gz", "tgz", "7z", "rar", "bz2"].includes(ext)) return "▤";
  if (["csv", "tsv", "xls", "xlsx", "ods"].includes(ext)) return "▦";
  if (["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp", "rb", "php", "sh", "lua"].includes(ext)) return "</>";
  if (["txt", "log", "md"].includes(ext)) return "≡";
  if (["doc", "docx", "rtf", "odt"].includes(ext)) return "¶";
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return "▶";
  return "📄";
}
