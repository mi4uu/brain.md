---
title: Tasks & Tables
tags: [feature, demo, gtd]
---

# Tasks & Tables

## Task lists

Markdown task syntax `- [ ]` / `- [x]`. The **Tasks** view in the
topbar aggregates every task across the vault — filter by open / done /
all.

- [x] Wire RAG pipeline to vault.onMutation
- [x] Mount MCP at `/mcp` + `/mcp/sse`
- [x] Add per-folder MCP permissions
- [ ] Ship the v3 launch post
- [ ] Record the 90-second demo video
- [ ] Tweet about [[brain.md launch]]

## Nested tasks

- [ ] Q3 product goals
  - [ ] Hit 100 active vaults
  - [ ] Document agent-side patterns
  - [x] Land RAG settings UI

## GFM tables

| Provider          | Model               | dim  | Cost    | Local? |
|-------------------|---------------------|-----:|---------|:------:|
| Xenova            | bge-small-en-v1.5   |  384 | free    |   ✓    |
| Ollama            | nomic-embed-text    |  768 | free    |   ✓    |
| OpenAI            | text-embedding-3-sm | 1536 | $0.02/M |   —    |
| Voyage AI         | voyage-3-lite       |  512 | $0.02/M |   —    |

| Op            | Path                  | Folder perm | Description           |
|---------------|-----------------------|-------------|-----------------------|
| read_note     | `/mcp` tool           | `read`      | Single-note body      |
| similar_notes | `/mcp` tool           | none        | Semantic RAG          |
| write_note    | `/mcp` tool           | `write`     | Create / overwrite    |
| append_note   | `/mcp` tool           | `write`     | Append a paragraph    |
