# MCP server

`brain.md` ships a Model Context Protocol server on the same Elysia app,
at `POST /mcp`. Transport: streamable HTTP in stateless JSON-response
mode. Each POST gets the whole JSON-RPC response in one round trip, with
a fresh server and transport per request, because several clients open
and close a transport per call. No SSE stream; server-to-client
notifications are not sent.

The endpoint shares auth with the rest of the HTTP API: when a password
or a login provider is configured, every request needs a bearer token
(session, API key or OAuth access token).

## Tools (17)

| Tool                  | Read-only | Folder perm | What it does                                                       |
|-----------------------|-----------|-------------|--------------------------------------------------------------------|
| `search_notes`        | yes       | read        | Full-text vault search (top 50, optional folder scope)             |
| `similar_notes`       | yes       | read        | Semantic RAG search, top-k chunks (needs RAG enabled)              |
| `read_note`           | yes       | read        | Note body + mtime; links the MCP Apps note view                    |
| `list_notes`          | yes       | read        | Vault tree, filtered                                               |
| `get_backlinks`       | yes       | read        | Inbound wikilinks with line and context                            |
| `list_tags`           | yes       | read        | Tag to count map                                                   |
| `get_tasks`           | yes       | read        | Tasks across the vault (open / done / all)                         |
| `current_datetime`    | yes       | none        | Server date, time and timezone                                     |
| `find_related`        | yes       | read        | Notes semantically close to a given note                           |
| `find_similar_tasks`  | yes       | read        | Semantic search across task lines                                  |
| `semantic_outline`    | yes       | read        | A note's chunks grouped by topic                                   |
| `context_for_query`   | yes       | read        | Top chunks for a query packed into a markdown block (token cap)    |
| `find_orphans`        | yes       | read        | Notes with no backlinks and few semantic neighbours                |
| `weekly_digest`       | yes       | read        | Topic clusters across recently modified notes                      |
| `compare_notes`       | yes       | read        | Similarity, unified diff and shared headings of two notes          |
| `write_note`          | no        | write       | Create or overwrite a note                                         |
| `append_note`         | no        | write       | Append a paragraph; returns only path and mtime                    |

"Folder perm: read" means results from folders the caller can't read are
left out, or the call is refused for a single note.

### Annotations

Every tool carries MCP annotations, so hosts can decide what needs a
prompt:

- read and search tools: `readOnlyHint: true`. The local ones also set
  `openWorldHint: false`; the RAG ones leave it unset because a
  configured remote embedder receives the query text.
- `write_note`: `readOnlyHint: false`, `destructiveHint: true`,
  `idempotentHint: false` (a repeat with the same content still bumps
  mtime and notifies watchers).
- `append_note`: `readOnlyHint: false`, `destructiveHint: false`,
  `idempotentHint: false`.

Annotations are hints for the host. Access is enforced by brain.md: the
caller's scope (owner, API key, OAuth grant) plus per-folder permissions.

## Per-folder permissions

`read` / `write` per folder, set in the vault tree (right-click a folder,
"MCP permissions…"). Resolution walks from the note's folder upward; the
nearest explicit setting wins; the default is read + write. A corrupt or
unreadable `folder-meta.json` denies everything until it is fixed.

## Resources

- `vault://tree`: JSON `{folders, notes}` filtered by read perms
- `vault://note/<path>`: markdown body
- `ui://brainmd/note.html`: the MCP Apps note view (only when the web
  bundle with the view is present, which it is in release binaries)

## MCP Apps

`read_note` declares `_meta.ui.resourceUri = "ui://brainmd/note.html"`.
Hosts that support the MCP Apps extension (`io.modelcontextprotocol/ui`)
render the note there: wikilinks open in place, Back, backlinks, light
and dark from the host.

- The view is one self-contained HTML file (`text/html;profile=mcp-app`,
  about 1.4 MiB) with no network access. It is built into
  `web/dist/mcp-apps/` by `bun run build` and embedded in the binary.
- `read_note`'s `content` is unchanged for every client. When the view is
  present, the result also carries `_meta["brainmd/note-view"]`:
  `{ backlinks, links }`, where `links` maps each wikilink target in the
  note to a readable path or `null`. Both are filtered by the caller's
  read permissions. Backlinks are capped at 100 (contexts at 200
  characters) with `truncated: true` when cut. Per spec, hosts keep `_meta` out of the model's
  context.
- `write_note` and `append_note` carry `_meta.ui.visibility: ["model"]`,
  so a spec-following host does not let a view call them.
- If the host mounts the view but never forwards the tool result, the
  view calls `read_note` itself after 6 s (path from the tool input), or
  shows a note picker.

## CLI

- `brainmd` runs the server with MCP mounted
- `brainmd --mcp-disabled` skips the MCP routes

## Clients that speak streamable HTTP

Claude Code, Cursor, Continue, Cline, Zed, OpenClaw, the official
`@modelcontextprotocol/inspector`:

```jsonc
{
  "mcpServers": {
    "brain.md": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        // only when auth is configured
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

OpenClaw:

```bash
openclaw mcp add brainmd --url http://localhost:3000/mcp --transport streamable-http
openclaw mcp configure brainmd --approval auto   # reads silent, writes prompt
openclaw config set mcp.apps.enabled true --strict-json   # for the note view; restart the Gateway
```

## Claude Desktop: stdio bridge

Claude Desktop speaks only stdio. Bridge it with
[`mcp-remote`](https://github.com/geelen/mcp-remote) in
`~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent path:

```jsonc
{
  "mcpServers": {
    "brain.md": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3000/mcp"
        // with auth: , "--header", "Authorization: Bearer <token>"
      ]
    }
  }
}
```

> `mcp-remote` notes that Cursor and Claude Desktop on Windows don't
> escape spaces inside `args`. Keep URL and header values free of
> spaces.

### Getting a bearer token

With a password set (Settings, Security):

```sh
curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"password":"<your-password>"}'
# {"token":"…","expiresAt":…}
```

For agents, an API key (Settings, "API Keys") is the better fit:
it doesn't expire with the session and has its own name in the audit
trail.

## Auditing

Every tool call is logged to stderr:

```
[mcp] tool=read_note ok=true args={"path":"Daily/2024-01-15.md"}
```
