# brain.md

Web Obsidian clone. Bun + Elysia + React. SPEC.md is source of truth.

## Quick start
```sh
bun install
bun run dev:server   # :3000
bun run dev:web      # :5173 (proxies /api → :3000)
```

Env: `VAULT_DIR` (default `./vault`), `PORT` (default `3000`).
