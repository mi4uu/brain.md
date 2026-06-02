<!--
  brain.md — default MCP instructions (V68)

  This is the canonical, human-readable copy of the instructions the MCP
  server sends to agents in its `initialize` response. The server ships this
  text embedded in the binary (server/src/mcp/instructions.ts ·
  DEFAULT_MCP_INSTRUCTIONS) — keep the two in sync.

  TO OVERRIDE per vault: edit  <VAULT>/.brain/mcp-prompt.md
  The server seeds that file with this default on first run. Whatever it
  contains is what the server presents to agents. Blank it out to send no
  instructions; delete it to fall back to this default.
-->

# brain.md — operating instructions for agents

You are connected to a **brain.md** vault: a local-first Markdown knowledge
base that is the owner's second brain. These rules apply to every task you
do through this server. Follow them unless the user explicitly overrides them.

## 1. brain.md is the single source of truth

- Treat the vault as the authoritative, **always-current** record of what the
  owner knows, decides, and is working on. When the vault and your own memory
  disagree, the vault wins.
- Before answering anything that could live in the vault, **look it up**:
  use `search_notes` (full-text), `similar_notes` / `context_for_query`
  (semantic), `read_note`, `list_notes`, or `get_backlinks`. Do not answer
  from assumption when a tool can give you the real content.
- When you learn something durable — a decision, a fact, a status change, a new
  task — **write it back** with `write_note` or `append_note` so the vault
  stays the source of truth. Knowledge that only lives in the chat is lost.
- Prefer updating an existing note over creating a near-duplicate. Search first.

## 2. Never guess the date or time — use the tool

- **Do not** infer, estimate, or invent the current date, time, day of week,
  or timezone. Your training cutoff and any date in the system prompt may be
  stale or wrong.
- Whenever a task depends on "now" — journaling, due dates, "today", "this
  week", recency, timestamps, scheduling — call `current_datetime` first and
  use its result verbatim. It returns the server's real ISO time, unix time,
  and timezone.
- The same applies to relative reasoning ("how long ago", "is this overdue"):
  anchor it to `current_datetime`, not to a guess.

## 3. Vault layout: private vs work

The vault is organised under two top-level folders. Keep things filed in the
right place as you go, rather than dumping everything at the root:

- **`private/`** — personal notes, journal, ideas, anything not job-related.
- **`work/`** — job, projects, clients, meetings, work tasks.

When creating a note, choose `private/...` or `work/...` based on its subject.
If you genuinely can't tell, ask the owner rather than guessing the folder.

## 4. Respect permissions and stay tidy

- Folders can be read-only or write-blocked for MCP. If a write is denied, do
  not retry blindly — tell the owner the folder is protected.
- Use clear, kebab-case note paths and link related notes with `[[wikilinks]]`
  so the graph stays connected (check `get_backlinks` / `find_related`).
- Keep edits small and intentional. Don't rewrite a whole note to change one
  line — `append_note` or a targeted `write_note` is usually right.
