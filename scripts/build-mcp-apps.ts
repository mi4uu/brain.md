#!/usr/bin/env bun
// Builds the MCP Apps views into single self-contained HTML files under
// web/dist/mcp-apps/. Hosts load them into a sandboxed iframe with no
// network access, so every script and style is inlined. Runs after
// `vite build`, which empties web/dist.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const WEB = join(REPO_ROOT, "web");
const OUT_DIR = join(WEB, "dist", "mcp-apps");
const MAX_BYTES = 2 * 1024 * 1024;

const VIEWS = [{ name: "note", entry: join(WEB, "src", "mcp-apps", "note.ts"), title: "brain.md note" }];

// The sandbox CSP has no font-src for data: or remote origins, so KaTeX
// falls back to system fonts instead of shipping ~1 MB of web fonts.
function katexCss(): string {
  const require = createRequire(join(WEB, "package.json"));
  const css = readFileSync(require.resolve("katex/dist/katex.min.css"), "utf8");
  return css.replace(/@font-face\{[^}]*\}/g, "");
}

function inlineSafe(code: string, tag: "script" | "style"): string {
  return code.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const view of VIEWS) {
  const result = await Bun.build({
    entrypoints: [view.entry],
    target: "browser",
    format: "esm",
    minify: true,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  let js = "";
  let css = katexCss();
  for (const out of result.outputs) {
    if (out.path.endsWith(".js")) js += await out.text();
    else if (out.path.endsWith(".css")) css += await out.text();
    else {
      console.error(`[build-mcp-apps] unexpected output ${out.path}; views must stay single-file`);
      process.exit(1);
    }
  }
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${view.title}</title>
<style>${inlineSafe(css, "style")}</style>
</head>
<body>
<div id="root"></div>
<script type="module">${inlineSafe(js, "script")}</script>
</body>
</html>
`;
  const bytes = Buffer.byteLength(html);
  if (bytes > MAX_BYTES) {
    console.error(`[build-mcp-apps] ${view.name}.html is ${bytes} bytes, over the 2 MiB host limit`);
    process.exit(1);
  }
  writeFileSync(join(OUT_DIR, `${view.name}.html`), html);
  console.log(`[build-mcp-apps] ${view.name}.html ${(bytes / 1024).toFixed(0)} KiB`);
}
