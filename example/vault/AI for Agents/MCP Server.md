---
title: MCP Server
aliases: [MCP, Model Context Protocol]
tags: [ai, mcp, agents, demo]
---

# MCP — your vault as an agent context

brain.md mounts a **Model Context Protocol** server on the same
Elysia app at `/mcp` (POST) and `/mcp/sse` (streaming). Transport is
the 2024-11-05 streamable-HTTP variant — works with Claude Desktop
out of the box.

## Tools (9)

| Tool             | Folder perm | What it does                              |
|------------------|-------------|-------------------------------------------|
| `search_notes`   | none        | Full-text vault search                    |
| `similar_notes`  | none        | Semantic RAG (top-k chunks)               |
| `read_note`      | `read`      | Note body + mtime                         |
| `list_notes`     | `read`      | Filtered vault tree                       |
| `get_backlinks`  | `read`      | Inbound wikilinks                         |
| `list_tags`      | none        | Tag → count map                           |
| `get_tasks`      | none        | Aggregate tasks (filter: open/done/all)   |
| `write_note`     | `write`     | Create or overwrite a note                |
| `append_note`    | `write`     | Append paragraph (blank-line separator)   |

Every call is logged to stderr for audit:

```
[mcp] tool=read_note ok=true args={"path":"Daily/2026-05-27.md"}
```

## Resources (2)

- `vault://tree` — JSON `{folders, notes}` filtered by read perms
- `vault://note/<path>` — markdown body

## Claude Desktop config

```json
{
  "mcpServers": {
    "brain.md": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer <token-from-login>"
      }
    }
  }
}
```

The `Authorization` header is only required when you've set a password
(Settings → Security). With no password set, MCP is open on the loopback
interface.

## See also

- [[Folder Permissions]] — fine-grained per-folder read/write control
- [[RAG (Semantic Search)]] — what powers `similar_notes`
