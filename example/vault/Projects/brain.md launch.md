---
title: brain.md launch
status: in-progress
tags: [project, launch, ai]
aliases: [Launch, v3 Launch]
---

# brain.md v3 launch

The first release that bundles the second-brain editor with an
**agent surface** (MCP) and **semantic search** (RAG).

## Goals

> [!tip] North star
> Make brain.md the simplest way to give a personal AI agent a
> long-lived, structured memory.

- [x] Land RAG pipeline + LanceDB store
- [x] Land MCP server (9 tools + 2 resources)
- [x] Land optional password auth + per-folder MCP perms
- [x] Ship Settings UI for RAG + Security
- [ ] Record 90-second product video → see [[#Video script]]
- [ ] Write launch announcement → see [[#Announcement]]
- [ ] Cross-post to HN / Reddit r/ObsidianMD / r/LocalLLaMA

## Video script

90 seconds:

1. **0-15s** — show editor + preview, type a note, autosave
2. **15-30s** — open Tags accordion, click a tag, show filter
3. **30-50s** — open Settings → AI/RAG, enable, set Ollama endpoint,
   click Reindex
4. **50-70s** — show Claude Desktop with brain.md MCP loaded, ask
   "summarise my Journal from last week"
5. **70-90s** — show the answer; emphasize **local-first**,
   **no API key by default**, **per-folder permissions**

## Announcement

Short pitch:

> brain.md is an open-source second brain that talks to AI agents
> over MCP. Your notes stay on disk as plain markdown; an embedded
> LanceDB gives Claude (or any MCP client) semantic search; per-folder
> permissions let you keep your private notes private.

See also: [[Q3 roadmap]], [[RAG (Semantic Search)]], [[MCP Server]].

## Open questions

- Should we ship a Docker image alongside the CLI? %% leaning yes %%
- Default port: 3000 or 7777? Current = 3000.
- Add a `brain init` command that scaffolds a new vault?
