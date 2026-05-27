// Stub for the build-generated asset map. Replaced at release time by
// scripts/gen-web-assets.ts which emits an updated version of this file
// with real `import … with { type: "file" }` lines + a populated ASSETS
// map. When the map is empty (dev workflow, no prior build), the server
// falls back to disk (web/dist) and then to a GitHub-Release download
// cache — see web/serve.ts.

// Keys are forward-slash paths relative to web/dist (e.g. "index.html",
// "assets/index-Abc123.js"). Values are file paths that Bun.file() can
// read; in compiled binaries these reference assets embedded inside the
// executable.
export const ASSETS: Record<string, string> = {};

// Marker so we can detect whether the file was regenerated.
export const ASSETS_GENERATED_AT: number | null = null;
