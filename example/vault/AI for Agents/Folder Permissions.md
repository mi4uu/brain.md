---
title: Folder Permissions
tags: [ai, mcp, security, demo]
---

# Folder Permissions

Per-folder MCP `{read, write}` flags let you keep sensitive notes out
of agent reach without locking down the whole vault.

> [!warning] Default is **rw** everywhere
> Without explicit overrides, every folder is fully open to MCP.
> Set restrictive overrides on folders that contain anything you
> don't want agents reading or modifying.

## How resolution works

When an MCP tool touches `Journal/Private/2026-05-15.md`, brain.md
walks the folder chain:

1. `Journal/Private` → checks for override
2. `Journal` → if no Private override, checks here
3. `""` (root) → final fallback
4. **Default** `{read:true, write:true}` if no rule matched

Nearest explicit override wins.

## UI

Right-click any folder in the sidebar → **MCP permissions…** opens a
Radix Dialog with two switches and a *Reset to inherited* button.

## API

| Method | Path                              | What           |
|--------|-----------------------------------|----------------|
| GET    | `/api/folder-mcp-perms`           | Whole map      |
| POST   | `/api/folder-mcp-perms`           | Upsert one     |
| DELETE | `/api/folder-mcp-perms/*path`     | Drop override  |

## Recipes

- **Lock down Journal**: set `Journal` to `{read: true, write: false}`
  so agents can search/read but never edit your diary.
- **Project handoff folder**: `Inbox/Agent` → `{read: true, write: true}`,
  everywhere else → `{read: true, write: false}`. The agent can drop
  drafts into Inbox/Agent for you to review.
- **Total readonly**: root → `{read: true, write: false}`.
