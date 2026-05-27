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

## Claude Desktop

Open `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) and add:

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

Restart Claude Desktop. The 9 tools + 2 resources appear under the
"brain.md" server.

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
