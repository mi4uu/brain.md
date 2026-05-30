# MCP server

`brain.md` ships a Model Context Protocol server mounted on the same
Elysia app under `/mcp/*`. Transport: **Streamable HTTP + SSE**
(MCP 2024-11-05 spec).

## Endpoints
- `POST /mcp`     — JSON-RPC entry point
- `GET  /mcp/sse` — server → client streaming
- both share the same auth as the rest of the HTTP API (§V53)

## Tools
| name            | what it does                                         | folder perms |
|-----------------|------------------------------------------------------|--------------|
| `search_notes`  | full-text vault search                               | none         |
| `similar_notes` | semantic search via RAG (needs RAG enabled)          | none         |
| `read_note`     | note body + mtime                                    | read         |
| `list_notes`    | tree listing, filtered                               | read         |
| `get_backlinks` | inbound wikilinks                                    | read         |
| `list_tags`     | tag → count map                                      | none         |
| `get_tasks`     | aggregate tasks (open / done / all)                  | none         |
| `write_note`    | create or overwrite                                  | write        |
| `append_note`   | append a paragraph                                   | write        |

Per-folder perms (`read` / `write`) are configured per folder in the
Settings → Vault tree (right-click a folder → "MCP permissions…").
Resolution walks from the note's parent folder upward; nearest explicit
override wins; default is read+write.

## Resources
- `vault://tree` — JSON `{folders, notes}` filtered by read perms
- `vault://note/<path>` — markdown body

## CLI
- `brain` runs the server with MCP mounted by default
- `brain --mcp-disabled` skips mounting the MCP routes

## Native streamable-HTTP clients

Claude Code, Cursor, Continue, Cline, Zed, the official
`@modelcontextprotocol/inspector` — anything that speaks streamable
HTTP — wires up directly:

```jsonc
{
  "mcpServers": {
    "brain.md": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        // optional, only when /api/auth is configured
        "Authorization": "Bearer <token-from-login>"
      }
    }
  }
}
```

Restart the client. The 17 tools + 2 resources appear under the
"brain.md" server.

## Claude Desktop — stdio bridge

The Claude Desktop app (macOS / Windows) only speaks **stdio** at the
MCP transport layer — streamable HTTP and SSE are not supported. Bridge
through [`mcp-remote`](https://github.com/geelen/mcp-remote), which
runs as a stdio child of Claude Desktop and forwards every JSON-RPC
call over HTTP to brain.md.

Open `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) — equivalent path on Windows / Linux — and add:

```jsonc
{
  "mcpServers": {
    "brain.md": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp"
        // when auth is enabled, also:
        // , "--header", "Authorization: Bearer <token-from-login>"
      ]
    }
  }
}
```

Restart Claude Desktop. The 17 tools + 2 resources appear under the
"brain.md" server.

> **Caveat from `mcp-remote`**: Cursor and Claude Desktop on Windows
> have a known bug where spaces inside `args` aren't escaped. Keep URL
> and header values quote-clean, no embedded spaces in the `--header`
> value.

### Getting a bearer token

When the vault has a password set (Settings → Security), every MCP
request needs a Bearer token. Get one:

```sh
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"password":"<your-password>"}'
# → {"token":"…","expiresAt":…}
```

Drop the token into the Claude Desktop config above. Tokens are
in-memory on the server (V53) — restart the server and clients
re-login.

## Auditing
Every tool call is logged to stderr:
```
[mcp] tool=read_note ok=true args={"path":"Daily/2024-01-15.md"}
```
