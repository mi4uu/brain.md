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
```

Precedence: **CLI flag > env var > XDG default**. Unknown flag → exit 2.

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
