# brain.md

Web Obsidian clone. Bun + Elysia + React. SPEC.md is source of truth.

## Quick start
```sh
bun install
bun run dev:server   # :3000
bun run dev:web      # :5173 (proxies /api → :3000)
```

## CLI
```sh
brain [options]            # or: bun run start
brain --help               # -h
brain --version
brain --vault-dir <path>   # -v <path>
brain --port <n>           # -p <n>
brain --mcp-disabled       # skip mounting MCP at /mcp/*
```

Precedence: **CLI flag > env var > XDG default**. Unknown flag → exit 2.

## AI / MCP

- **RAG**: local-first vector search over the vault via LanceDB.
  Default embedder = `bge-small-en-v1.5` (Xenova ONNX, runs locally).
  Switch to any OpenAI-compatible `/v1/embeddings` (Ollama, LM Studio,
  OpenAI…) under Settings → AI / RAG.
- **MCP server**: HTTP+SSE, mounted on the same Elysia app at
  `/mcp` and `/mcp/sse`. 9 tools + 2 resources. See
  [docs/mcp.md](docs/mcp.md) for the Claude Desktop config snippet.
- **Auth**: optional. No password by default — the whole API + MCP
  are open. Set a password in Settings → Security; once set, every
  /api/* + /mcp/* request needs `Authorization: Bearer <token>`.
- **Folder permissions**: each folder can override MCP `read` / `write`
  via right-click → "MCP permissions…" in the file tree. Nearest
  ancestor override wins; default is read+write everywhere.

## Default paths (all platforms — XDG Base Directory Spec)

| Purpose  | Env var            | Default                                     |
|----------|--------------------|---------------------------------------------|
| Vault    | `XDG_DATA_HOME`    | `$HOME/.local/share/brain.md/vault`         |
| Settings | `XDG_CONFIG_HOME`  | `$HOME/.config/brain.md/`                   |

Same logic on macOS, Linux, Windows — no OS branching. The vault dir is
created (`mkdir -p`) on first run.

## Env

| Var                            | Default | Notes                                     |
|--------------------------------|---------|-------------------------------------------|
| `VAULT_DIR`                    | XDG     | Overridden by `--vault-dir`.              |
| `PORT`                         | `3000`  | Overridden by `--port`.                   |
| `XDG_DATA_HOME`                | —       | Base for default vault location.          |
| `XDG_CONFIG_HOME`              | —       | Base for default settings location.       |
| `GIT_AUTOCOMMIT`               | `1`     | `1` / `0`. Bootstrap default only.        |
| `GIT_AUTOCOMMIT_DEBOUNCE_MS`   | `15000` | Bootstrap default only.                   |
