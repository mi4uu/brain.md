import { defaultSchema } from "rehype-sanitize";
import type { Options as Schema } from "rehype-sanitize";

// Extends the GitHub-style default schema so the preview can keep rendering
// everything the app itself emits (KaTeX output, highlight.js spans, our own
// callout/embed/wikilink/tag markup, mermaid placeholders, heading ids used
// for scroll sync) while still blocking script execution: no event-handler
// attributes (property-information maps them to hast properties that never
// match any allow list below, so they are dropped unconditionally), no
// <script>/<style>/<iframe>/<object>/<embed>, and no javascript:/vbscript:
// URLs (the href/src protocol allow lists below never include them).
const mathmlTags = [
  "math",
  "semantics",
  "annotation",
  "mrow",
  "mi",
  "mn",
  "mo",
  "mtext",
  "mspace",
  "mfrac",
  "msqrt",
  "mroot",
  "msub",
  "msup",
  "msubsup",
  "mtable",
  "mtr",
  "mtd",
  "mstyle",
  "mpadded",
];

export const previewSchema: Schema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "mark",
    "video",
    "audio",
    "svg",
    "path",
    "line",
    "polyline",
    "g",
    "button",
    "header",
    ...mathmlTags,
  ],
  attributes: {
    ...defaultSchema.attributes,
    // `data*` allows any data-* attribute: our plugins emit data-source-line
    // (scroll sync), data-wikilink/data-resolved/data-section (wikilinks),
    // data-tag, data-attachment(-ext), data-target/data-embed-path (embeds),
    // data-mermaid (diagram source kept as an opaque string attribute).
    // `className` unconditional on `*` lets any of our own or hand-written
    // classes through; it does not grant script execution.
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "data*", "className", "style", "loading", "controls"],
    // The default schema restricts `className` on `a` and `code` to GitHub's
    // own narrow values (a footnote-backref class; a `language-*` regex).
    // That specific entry is checked before the unconditional `className`
    // on `*`, and any match -- even a partial one for an array value like
    // `class="hljs language-ts"` -- wins outright instead of falling
    // through, silently dropping our own classes (wikilink/tag/attachment
    // on `a`, `hljs` on `code`). Drop the restriction for both so the
    // unconditional `*` entry takes over.
    a: [...(defaultSchema.attributes?.a ?? []).filter((d) => !(Array.isArray(d) && d[0] === "className")), "download"],
    code: [],
    button: ["type", "ariaLabel"],
    img: [...(defaultSchema.attributes?.img ?? []), "alt", "width", "height"],
    video: ["src", "controls", "width", "height"],
    audio: ["src", "controls"],
    source: [...(defaultSchema.attributes?.source ?? []), "src", "type"],
    svg: ["viewBox", "width", "height", "fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "xmlns", "preserveAspectRatio"],
    path: ["d"],
    polyline: ["points"],
    line: ["x1", "y1", "x2", "y2"],
    g: ["transform"],
    math: ["display", "xmlns"],
    mi: ["mathvariant"],
    mo: ["fence", "separator", "stretchy"],
    mstyle: ["displaystyle", "scriptlevel"],
    mtable: ["columnalign", "columnspacing", "rowspacing"],
    annotation: ["encoding"],
  },
  protocols: {
    ...defaultSchema.protocols,
    // Relative media URLs (buildMediaUrl output, e.g. /api/media-raw/...)
    // are not affected by this list; it only gates URLs with an explicit
    // scheme. `data:` is added for src only, so pasted base64 images keep
    // working; href keeps the default (no data:, no javascript:).
    src: ["http", "https", "data"],
  },
  // Drop `id` from clobber-prefixing: heading ids (rehypeHeadingIds) and
  // wikilink section fragments (#slug) must match exactly for in-app
  // anchor navigation to work. aria-*/name clobber protection is kept.
  clobber: ["ariaDescribedBy", "ariaLabelledBy", "name"],
  strip: [...(defaultSchema.strip ?? []), "style", "iframe", "object", "embed"],
};
