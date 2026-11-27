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

## Tools (20)

| Tool                  | Read-only | Folder perm | What it does                                                       |
|-----------------------|-----------|-------------|--------------------------------------------------------------------|
| `search_notes`        | yes       | read        | Full-text vault search, 20 per page (`limit`, `offset`, up to 200), optional folder scope, `include_hidden` |
| `similar_notes`       | yes       | read        | Semantic RAG search, top-k chunks (needs RAG enabled)              |
| `read_note`           | yes       | read        | Note body, mtime, revision, parsed `properties`; links the MCP Apps note view |
| `list_notes`          | yes       | read        | Notes and folders, 100 notes per page (`limit`, `offset`, `folder`, `include_hidden`) |
| `query_notes`         | yes       | read        | Notes as a table: a `filter` expression, `columns`, `sort`, or a `base` / `path` view; 50 rows per page, `warnings` for syntax it cannot run |
| `get_backlinks`       | yes       | read        | Inbound wikilinks with line and context, 50 per page               |
| `graph_view`          | yes       | read        | Notes and wikilinks: vault, `folder`, or `center` + `depth` hops   |
| `list_tags`           | yes       | read        | Tags with counts, most used first, 100 per page                    |
| `get_tasks`           | yes       | read        | Tasks across the vault (open / done / all), 50 per page            |
| `current_datetime`    | yes       | none        | Server date, time and timezone                                     |
| `find_related`        | yes       | read        | Notes semantically close to a given note                           |
| `find_similar_tasks`  | yes       | read        | Semantic search across task lines                                  |
| `semantic_outline`    | yes       | read        | A note's chunks grouped by topic                                   |
| `context_for_query`   | yes       | read        | Top chunks for a query packed into a markdown block (token cap)    |
| `find_orphans`        | yes       | read        | Notes with no backlinks and few semantic neighbours                |
| `weekly_digest`       | yes       | read        | Topic clusters across recently modified notes                      |
| `compare_notes`       | yes       | read        | Similarity, unified diff and shared headings of two notes          |
| `write_note`          | no        | write       | Create or overwrite a note (`base_revision`, `create_only`)        |
| `append_note`         | no        | write       | Append a paragraph; returns only path and mtime (`base_revision`)  |
| `update_properties`   | no        | write       | Set or remove frontmatter keys without rewriting the note (`set`, `unset`, `base_revision`) |

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
- `update_properties`: `readOnlyHint: false`, `destructiveHint: true`,
  `idempotentHint: true` (an unchanged note is not rewritten).

Annotations are hints for the host. Access is enforced by brain.md: the
caller's scope (owner, API key, OAuth grant) plus per-folder permissions.

### query_notes

Runs a view over the notes, like an Obsidian Base. Pass one of `base` (the YAML
of a base), `path` (a `.md` note holding a ```` ```base ```` fence; `view` picks
the fence by view name, else the first one is used, and `this` is that note), or
the simple form `filter`, `columns` and `sort`. Combining forms is an
`INVALID_ARGUMENT` error; a note without a fence is `NO_BASE_BLOCK`. Syntax the
engine cannot run comes back in `warnings`, not as an error. Rows respect the
caller's per-folder read permissions and skip hidden notes.

Each row is `{ path, title, revision, values, partial? }`, plus `group` (the
label) and `group_key` (the raw key, `null` for "No value") when the view is
grouped. `revision` is what `update_properties` takes as `base_revision`.
`partial` lists the keys whose value is not the whole stored value: a cell cut
at 500 characters by `query_notes`, or cut or shortened by the engine. Never
write such a value back. Pages are 50 rows by default and stop early at about
200 KB; the engine also ends a page early when a very wide view would make the
response too large. In both cases `next_offset` continues where the page
stopped, and `total` counts every matching row.

`path` also runs fences indented inside a list item. The note preview renders
only top-level fences, so such a fence shows as plain code there but still runs
through `query_notes`.

### Paging

List tools return one page so a large vault does not flood the model's context.
`limit` sets the page size (each tool has its own default and maximum) and
`offset` skips that many items. The page keeps the shape the tool always
returned (an array, or `list_notes`' object, which also carries `total_notes`
and `next_offset`). When more remains, the result has a second text block, for
example `Showing notes 1-100 of 523. To get more, call list_notes again with the
same arguments and offset=100.`

## Agents editing the same notes

`read_note` returns a `revision` (a hash of the content). Pass it back as
`base_revision` and the write only happens if nobody changed the note in
between:

```jsonc
// read_note {"path": "work/plan.md"}  ->  {"content": "...", "revision": "9f2c..."}
// write_note:
{ "path": "work/plan.md", "content": "...my edit...", "base_revision": "9f2c..." }
// if another agent wrote first, nothing is written and the tool returns:
{ "error": "work/plan.md changed since you read it (current revision 41ab...)",
  "code": "CONFLICT", "current_revision": "41ab...",
  "hint": "read_note again, merge your change into the current content, and retry with the new base_revision" }
```

- `write_note` with `create_only: true` refuses to overwrite an existing note.
- `append_note` never loses another append (appends to one note are
  serialised); `base_revision` is for text that only makes sense after
  the content you read.
- Without these parameters both tools behave as before (last write wins).
- Revision checks need read access to the note, since a conflict reply
  carries the current revision.

## Changing properties

`read_note` returns `properties`, the parsed frontmatter (`null` when there is
none or it does not parse). `update_properties` changes keys without sending
the whole note, and only the touched lines change: comments, key order, list
style and line endings stay.

```jsonc
// update_properties:
{ "path": "work/plan.md", "set": { "status": "done", "due": "2026-12-01" }, "unset": ["draft"], "base_revision": "9f2c..." }
```

Values are strings, numbers, booleans, null, lists or maps. `base_revision`
works as for `write_note` (code `CONFLICT` with the current revision). A note
whose frontmatter does not parse fails with `INVALID_YAML`. A write-only
folder works but returns no revision.

## Which agent made a change

Every change is committed to the vault's git history with the identity
that made it: the signed-in person, or the API key / MCP client name. When
several agents share one credential, each can name itself in an HTTP
header:

```jsonc
"headers": {
  "Authorization": "Bearer <api key named openclaw>",
  "X-Brainmd-Agent": "sekretarz"
}
```

Commits from that agent are authored `openclaw/sekretarz` and listed
separately in the web History panel and its author filter. Letters,
digits, `.`, `_`, `-` and spaces, up to 48 characters. The header only
says which agent it is; permissions still come from the key, and it is
ignored for people.

## Hidden notes

Notes the owner hides (Settings, Vault, hidden globs; `hidden: true` in a
note's frontmatter) are left out of `list_notes`, `search_notes`,
`graph_view` and semantic search; `search: false` keeps a note listed but
out of search. `include_hidden: true` on `list_notes` and `search_notes`
brings them back. `read_note`, `write_note` and `append_note` work on any
note by path. Hiding is about clutter, not access: to keep agents out of a
folder, use per-folder permissions.

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
- `write_note`, `append_note` and `update_properties` carry `_meta.ui.visibility: ["model"]`,
  so a spec-following host does not let a view call them.
- If the host mounts the view but never forwards the tool result, the
  view calls `read_note` itself after 6 s (path from the tool input), or
  shows a note picker.

### Graph view

`graph_view` declares `ui://brainmd/graph.html` (about 480 KB). Its
`content` is a short summary for the model (note and link counts, notes
without links, the most linked notes). With the view built, the result
also carries `_meta["brainmd/graph-view"]`: `{ nodes, links, center,
truncated }`, filtered by read permissions and capped at 3,000 nodes. In
the view a click re-centres the graph on that note (one `graph_view`
call), Back steps out, and "Open in chat" sends the host a `ui/message`
asking to open the note.

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
