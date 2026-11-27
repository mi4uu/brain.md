# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Primary: the owner on his own instance.** Michał runs brain.md every day on a VPS, from a desktop browser and from a phone (installed PWA). His AI agents (Claude Code, Codex, OpenClaw) read and write the same vault over MCP, so a large share of the notes he opens were written or changed by an agent.
- **Right after him: technical self-hosters.** People who run one binary on their own machine or server as a memory layer for their own agents. They arrive from GitHub, MCP directories and self-hosting communities, install with a one-line script and point an MCP client at it.

## Product Purpose

brain.md is a local-first markdown vault with a live editor and preview, semantic search and an MCP server on the same port. It exists so that a person and all of their agents share one memory: notes the human can read and edit like any notes, and agents can search, read and write safely. Success is the owner (and self-hosters like him) keeping life admin, work and project state in the vault, with agents using it as their context instead of each tool keeping its own memory.

## Positioning

Shared memory for all agents (Claude Code, Codex, OpenClaw and others) that a human also reads and edits: plain `.md` files, one binary, MCP with per-folder permissions, git with the agent's signature on every change, no subscription and no desktop app.

It is narrower than Obsidian or Notion on purpose: not a plugin ecosystem, not a database product, not a team task tool.

## Operating Context

- Vault is a plain folder of `.md` files with YAML frontmatter, Obsidian-compatible (wikilinks, embeds, callouts, math, mermaid, tasks, aliases). Users may open the same folder in Obsidian, VS Code or any editor.
- Agents connect over MCP (streamable HTTP, 20 tools, MCP Apps views for notes and the graph in hosts that support them). Agent writes carry an `X-Brainmd-Agent` identity and land as attributed git commits.
- Human use is mixed: quick capture and lookup on the phone, longer editing and review on desktop.
- Typical owner workflows: daily journal, tasks across notes, job search and client notes, project state written by agents and reviewed by the owner, history and restore when an agent gets something wrong.
- Reminders and scheduling are done by an external agent (OpenClaw cron), not by brain.md.

## Capabilities and Constraints

- Editor (CodeMirror 6) with live preview, command palette, quick switcher, tasks view, graph view and local graph, backlinks, related notes, outline, bookmarks, trash, history with author and restore.
- Semantic search built in: embedded vector store, local WASM ONNX embedder by default, or any `/v1/embeddings` endpoint (Ollama, LM Studio, OpenAI, a remote llama-server). Falls back to keyword search when the embedder fails.
- Per-folder read/write permissions for the MCP surface; hidden notes (`hidden: true`, globs) and no-index notes (`search: false`); write conflict protection (`base_revision`, `create_only`).
- Optional auth: password (argon2id, bearer tokens) or OAuth login (Google, GitHub, Keycloak, Authentik). Off by default.
- Git autocommit with a per-path audit trail; the vault is a real git repo.
- Accent colour is a user setting (presets in Settings > Editor).
- Technical constraints: AGPL-3.0-or-later; ships as a single `bun --compile` binary with the web UI embedded; runs fully offline with zero API keys; no Electron or native desktop app; web UI is React + Vite + Tailwind with CSS custom-property tokens.
- Undecided / planned (roadmap, not built): note types, properties panel and saved views (table, kanban, calendar, cards) on plain frontmatter; full themes and skins beyond accent presets; Typst PDF export; one-command `bunx` start and `brainmd setup <agent>`; first-run guided vault; public read-only demo.

## Brand Commitments

- Name: **brain.md**, always lowercase with `.md`. Binding.
- The logo mark is not binding. The glossy PNG brain (README, About, favicon) and the flat `[[•]]` topbar mark both exist; which one is the identity is an open decision.

## Evidence on Hand

- README feature list and comparison table against Obsidian, Logseq and Notion (factual, per feature).
- Screenshots and GIFs in `docs/img/` (some predate the 2026-11 UI redesign) and a generated demo vault in `example/`.
- Retrieval evaluation harness in `eval/retrieval/` with a measured result on the owner's private vault (nDCG@10 0.888 with the current embedder vs 0.606 before); the query set itself is private.
- MCP reference in `docs/mcp.md`; Glama MCP server badge in the README.
- Absent, do not fabricate: user counts, testimonials, customer logos, star counts as claims, press, performance claims beyond the measured graph (3000 notes) and retrieval numbers, a hosted service or pricing.

## Product Principles

1. **Files are the source of truth.** Everything lives in plain markdown and frontmatter the user can take to another tool; no feature may lock data into brain.md.
2. **Humans and agents are equal citizens.** What a person can do in the UI, an agent can do over MCP, and every change shows who made it.
3. **Safe by default for agents.** Permissions, hidden and no-index notes, conflict protection and history exist so an agent can be trusted with the vault; new write paths respect them.
4. **The phone is first-class.** Every feature has to work on a phone (PWA), not only on desktop.
5. **Narrow on purpose.** One person's memory layer, not a plugin platform, team tracker or Todoist/Asana clone; outside jobs (reminders, calendars) stay with other tools.

## Accessibility & Inclusion

No formal standard has been set. Established so far: keyboard-operable controls with visible focus, 4.5:1 contrast for accent presets in light and dark, and touch-sized targets on coarse pointers.
