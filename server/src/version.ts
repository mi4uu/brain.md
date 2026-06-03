// Single source of truth for the server version string. Keep in sync with
// the `version` field in package.json on every release bump. Previously this
// string was hardcoded in three places (index.ts, web/serve.ts,
// mcp/server.ts) and drifted out of date — centralised here so a release
// only touches one line.
export const VERSION = "0.4.9";
