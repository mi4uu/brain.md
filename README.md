<div align="center">

<img src="web/public/brainmdlogo.png" alt="brain.md" width="120" />

# brain.md

**A local-first second brain for you — and for your AI agents.**

[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-black.svg)](https://bun.com)
[![MCP: streamable-http](https://img.shields.io/badge/MCP-streamable--http-7c3aed.svg)](docs/mcp.md)
[![RAG: LanceDB](https://img.shields.io/badge/RAG-LanceDB-ec4899.svg)](#-semantic-search-rag)

</div>

![brain.md welcome](docs/img/hero-welcome.png)

<div align="center">

### What you get

</div>

| | |
|---|---|
| 📝 &nbsp; **Obsidian-compatible markdown** | Wikilinks, embeds, callouts, math, mermaid, tasks, frontmatter, aliases. Open your existing Obsidian vault — it just works. |
| ⚡ &nbsp; **Live editor + preview** | CodeMirror 6 with cursor-anchored scroll sync, autosave, instant tooltips, command palette, quick switcher. |
| 🔍 &nbsp; **Semantic search built in** | Per-vault [LanceDB](https://lancedb.com) vector store. Notes are chunked, embedded and indexed on every save. No external service to set up. |
| 🤖 &nbsp; **Pluggable embedders** | Default: `bge-small-en-v1.5` running locally via Xenova ONNX. Or point at **Ollama**, **LM Studio**, **OpenAI** — anything with `/v1/embeddings`. |
| 🛰️ &nbsp; **MCP server (HTTP + SSE)** | 9 tools + 2 resources mounted on the same port. Claude Desktop and any MCP-compliant agent can read, search and write your notes. |
| 🔒 &nbsp; **Per-folder agent permissions** | Right-click a folder → set `{read, write}` for the MCP surface. Keep `Journal/Private/` out of agent reach without locking down the vault. |
| 🔑 &nbsp; **Optional password auth** | argon2id, bearer tokens, 24-hour TTL — gates both HTTP API and MCP. Off by default, on with one click. |
| 📜 &nbsp; **Git autocommit** | Every save lands in git. Full history, diff, restore, manual checkpoints. The vault is a real git repo on disk. |
| 🌍 &nbsp; **No vendor lock-in** | Your vault is a folder of `.md` files. Open it in VSCode, Obsidian, `cat`, anything. brain.md is just one more way to view and query it. |
| 💸 &nbsp; **Zero API keys required** | Out of the box it runs fully offline. Cloud embedders are an opt-in, not a default. |

---

## Why brain.md

LLMs are only as smart as the context you give them. **brain.md** turns
your notes into that context — without dragging them into someone
else's cloud, without locking them inside a proprietary format, and
without asking you to plumb a vector database yourself.

You write markdown. brain.md gives you:

- a polished **editor + live preview** with the full
  Obsidian-flavor dialect (wikilinks, embeds, callouts, math, mermaid,
  highlights, tasks, frontmatter, aliases),
- a per-vault **LanceDB** vector store with a local
  `bge-small-en-v1.5` embedder by default — switch to **Ollama**,
  **LM Studio**, **OpenAI**, or anything else with a `/v1/embeddings`
  endpoint with one toggle,
- an **MCP server** (HTTP + SSE) mounted on the same port, so
  Claude Desktop (or any MCP client) can read, search and write your
  notes safely — with **per-folder read/write permissions** for the
  agent surface,
- optional **password auth** and **git autocommit / restore** for the
  whole vault.

Everything runs on your machine. The vault is a plain folder of `.md`
files you can open in any editor at any time.

---

## Table of contents

- [Quick start](#-quick-start)
- [Install](#-install)
- [The interface](#-the-interface)
  - [Editor + preview](#editor--preview)
  - [Markdown that actually does things](#markdown-that-actually-does-things)
  - [Command palette + quick switcher](#command-palette--quick-switcher)
  - [Tasks across the vault](#tasks-across-the-vault)
- [AI for agents](#-ai-for-agents)
  - [Semantic search (RAG)](#-semantic-search-rag)
  - [MCP server](#-mcp-server)
  - [Per-folder permissions](#-per-folder-permissions)
  - [Optional password auth](#-optional-password-auth)
- [CLI](#-cli)
- [Defaults & paths](#-defaults--paths)
- [Architecture](#-architecture)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [License](#-license)

---

## ⚡ Quick start

```sh
git clone https://github.com/mi4uu/brain.md.git
cd brain.md
bun install

# in two shells:
bun run dev:server   # backend on :3000
bun run dev:web      # vite dev server on :5173 (proxies /api → :3000)
```

Open <http://localhost:5173>. First run creates your vault at
`$HOME/.local/share/brain.md/vault` (XDG default, same logic on macOS,
Linux and Windows).

To enable semantic search and the MCP `similar_notes` tool, open
**Settings → AI / RAG** and flip the switch. Default embedder is
`bge-small-en-v1.5` running locally via Xenova ONNX (one-time ~133 MB
model download, then fully offline).

> **Want a tour?** Point brain.md at the demo vault that ships with
> the repo:
> ```sh
> bun run dev:server -- --vault-dir "$PWD/example/vault"
> ```
> Every screenshot below was taken against [`example/vault/`](example/).

---

## 📦 Install

### From source

```sh
git clone https://github.com/mi4uu/brain.md.git
cd brain.md
bun install
bun run start            # runs the production server on :3000
```

For development:

```sh
bun run dev:server       # backend on :3000
bun run dev:web          # vite on :5173 (with /api proxy)
```

> Requires [Bun ≥ 1.3](https://bun.com). brain.md uses `Bun.password`
> (built-in argon2id) so you don't need a native crypto build.

---

## 🖥️ The interface

### Editor + preview

Two synchronised panes powered by **CodeMirror 6** and a
**unified / remark / rehype** rendering pipeline. The active block
in the preview stays anchored to the cursor in the editor; a thin SVG
connector marks the link between them.

![Editor + preview, sidebar with backlinks](docs/img/project-with-sidebar.png)

The right rail collects **Bookmarks · Vault · Tags · Outline ·
Backlinks**. Each section is collapsible and remembers its state per
device (`localStorage`). The **Tags** panel splits into *In this note*
and *Other tags* the moment you open a note.

### Markdown that actually does things

#### Callouts

![Callouts](docs/img/feature-callouts.png)

#### Math (KaTeX)

![Math rendering](docs/img/feature-math.png)

#### Mermaid diagrams

![Mermaid diagrams](docs/img/feature-mermaid.png)

#### Syntax-highlighted code

![Syntax-highlighted code](docs/img/feature-code.png)

### Command palette + quick switcher

- **⌘P / Ctrl+P** — search across titles and bodies
- **⌘O / Ctrl+O** — fuzzy quick switcher

Both are powered by [cmdk](https://cmdk.paco.me) inside a Radix Dialog.

![Command palette](docs/img/command-search.png)

### Tasks across the vault

Every `- [ ]` and `- [x]` in your notes is collected into a single
view, with filters for open / done / all and a click-through to the
source line.

![Tasks view](docs/img/tasks-view.png)

---

## 🤖 AI for agents

This is what makes brain.md more than another markdown editor.

### 🔍 Semantic search (RAG)

When a note is saved, brain.md chunks it (≤ 512 tokens, ~64-token
overlap, paragraph-aligned, frontmatter excluded), embeds each chunk,
and upserts the vectors into a per-vault **LanceDB** table at
`<VAULT>/.brain/lance/`.

| Provider                | Model                       | dim   | Local? | API key |
|-------------------------|-----------------------------|------:|:------:|:-------:|
| Xenova *(default)*      | `bge-small-en-v1.5`         |   384 |   ✓    |   —     |
| Ollama                  | e.g. `nomic-embed-text`     |   768 |   ✓    |   —     |
| LM Studio               | any served GGUF embedder    | varies|   ✓    |   —     |
| OpenAI                  | `text-embedding-3-small`    |  1536 |   —    |   ✓     |

![Settings — AI / RAG](docs/img/settings-rag.png)

REST surface:

| Method | Path                       | What                                              |
|--------|----------------------------|---------------------------------------------------|
| GET    | `/api/similar?q=…&k=…`     | Top-k semantic hits with snippet + line range     |
| GET    | `/api/rag/status`          | Provider, model, dim, chunks, `needsReindex`      |
| POST   | `/api/rag/reindex`         | Walks the vault and rebuilds the index            |
| POST   | `/api/rag/test`            | Dry-run an embedder config without saving         |

### 🛰️ MCP server

brain.md mounts a **Model Context Protocol** server on the same Elysia
app at `/mcp` (POST) and `/mcp/sse` (streaming). Transport is the
**2024-11-05 streamable HTTP** variant — works with Claude Desktop and
any MCP-compliant agent out of the box.

![MCP Server page in brain.md](docs/img/mcp-server-page.png)

Tools (9):

| Tool             | Folder perm | What it does                                |
|------------------|-------------|---------------------------------------------|
| `search_notes`   | none        | Full-text vault search                      |
| `similar_notes`  | none        | Semantic RAG (top-k chunks)                 |
| `read_note`      | `read`      | Note body + mtime                           |
| `list_notes`     | `read`      | Filtered vault tree                         |
| `get_backlinks`  | `read`      | Inbound wikilinks                           |
| `list_tags`      | none        | Tag → count map                             |
| `get_tasks`      | none        | Aggregate tasks (filter: open/done/all)     |
| `write_note`     | `write`     | Create or overwrite a note                  |
| `append_note`    | `write`     | Append a paragraph (blank-line separator)   |

Resources (2):

- `vault://tree` — JSON `{folders, notes}` filtered by read perms
- `vault://note/<path>` — markdown body

Drop this into `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent on your OS:

```json
{
  "mcpServers": {
    "brain.md": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

That's it — restart Claude Desktop and you'll see the tools appear.
Full reference: [docs/mcp.md](docs/mcp.md).

### 🔒 Per-folder permissions

Right-click any folder → **MCP permissions…** to set explicit
`{read, write}` flags. Resolution walks the parent chain to root;
nearest explicit override wins; default is read + write.

![Per-folder MCP permissions](docs/img/folder-perms.png)

This is how you keep `Journal/Private/` out of agent reach without
locking down the whole vault.

### 🔑 Optional password auth

Default: no auth. Set a password in **Settings → Security** to switch
on bearer-token authentication for *both* the HTTP API and the MCP
endpoints. Password is hashed with **argon2id** (Bun's built-in
`Bun.password`, no native crypto build needed); tokens live in memory
with a 24-hour TTL.

![Settings — Security](docs/img/settings-security.png)

---

## ⌨️ CLI

```sh
brain [options]            # or: bun run start
brain --help               # -h
brain --version
brain --vault-dir <path>   # -v <path>
brain --port <n>           # -p <n>
brain --mcp-disabled       # skip mounting MCP at /mcp/*
```

Precedence: **CLI flag > env var > XDG default**. Unknown flag →
stderr error + exit 2.

---

## 🗂️ Defaults & paths

| Purpose  | Env var            | Default                                     |
|----------|--------------------|---------------------------------------------|
| Vault    | `XDG_DATA_HOME`    | `$HOME/.local/share/brain.md/vault`         |
| Settings | `XDG_CONFIG_HOME`  | `$HOME/.config/brain.md/`                   |

Same logic on macOS, Linux, Windows — no OS branching. The vault dir
is `mkdir -p`-ed on first run.

Per-vault state lives under `<VAULT>/.brain/`:

```
<VAULT>/
├── Welcome.md
├── Folder/
│   ├── Note.md
│   └── .media/
│       └── img.png
└── .brain/
    ├── index.json          # mtime-based search index
    ├── settings.json       # bookmarks, dailyDir, git autocommit, rag config
    ├── folder-meta.json    # icons, colors, per-folder MCP perms
    ├── auth.json           # argon2id hash — absent when auth is off
    ├── lance/              # LanceDB tables (RAG), git-ignored
    └── trash/<ts>/...      # recoverable deletes
```

Every env knob:

| Var                            | Default | Notes                                     |
|--------------------------------|---------|-------------------------------------------|
| `VAULT_DIR`                    | XDG     | Overridden by `--vault-dir`.              |
| `PORT`                         | `3000`  | Overridden by `--port`.                   |
| `XDG_DATA_HOME`                | —       | Base for default vault location.          |
| `XDG_CONFIG_HOME`              | —       | Base for default settings location.       |
| `GIT_AUTOCOMMIT`               | `1`     | `1` / `0`. Bootstrap default only.        |
| `GIT_AUTOCOMMIT_DEBOUNCE_MS`   | `15000` | Bootstrap default only.                   |

---

## 🏗️ Architecture

```
+----------------+        /api/*        +-------------------+
|  React + CM6   | <------------------> |                   |
|  web client    |                      |                   |
+----------------+                      |   Elysia (Bun)    |  +-------------+
                                        |                   |  | Vault FS    |
+----------------+   /mcp HTTP+SSE      |   - Vault         |  | .brain/     |
| Claude Desktop | <------------------> |   - VaultIndex    |--|   index     |
| (or any MCP    |                      |   - GitRepo       |  |   trash     |
|  client)       |                      |   - SettingsStore |  |   lance/    |
+----------------+                      |   - AuthStore     |  |   auth.json |
                                        |   - MCP server    |  +-------------+
                                        |   - RAG pipeline  |
                                        +-------------------+
                                                  |
                                                  v
                                        +-------------------+
                                        | LanceDB (vectors) |
                                        | Xenova / OAI emb. |
                                        +-------------------+
```

- **Runtime**: Bun
- **Backend**: Elysia + native FS + GitRepo (libgit-free shell wrapper
  with an async write mutex)
- **Frontend**: React 18 + CodeMirror 6 + unified/remark/rehype +
  highlight.js + KaTeX + mermaid (lazy) + Radix UI primitives +
  Tailwind tokens (CSS vars under the hood)
- **Vector store**: LanceDB (`@lancedb/lancedb`) per vault
- **MCP transport**: `@modelcontextprotocol/sdk`
  `WebStandardStreamableHTTPServerTransport`
- **Auth**: `Bun.password` (argon2id, no native build)

Per-component documentation lives next to the code; see [docs/](docs/)
for the MCP reference.

---

## 🛣️ Roadmap

- Daily-note templates with variable interpolation
- Snippet expansion in the editor (`/` trigger)
- Hybrid search (BM25 + dense), fused via RRF
- Multi-vault support behind a single server
- Encrypted vaults (age key per vault)
- Docker image (multi-arch, < 200 MB compressed)
- Notarised macOS `.app` wrapping the binary
- Hosted read-only demo

Want to nudge one of these up the list? Open an issue or PR.

---

## 🤝 Contributing

Contributions welcome.

1. Open an issue first for anything non-trivial — a quick design
   sketch saves a long PR rewrite.
2. Write the test before the implementation. Server tests run with
   `bun test`; the suite is currently **160 green**.
3. Open a PR. CI runs typecheck (server + web) + `bun test`.

---

## 📄 License

**GNU Affero General Public License v3.0 or later** — see
[LICENSE](LICENSE).

brain.md is, and will stay, free / libre / open-source. The AGPL was
picked over weaker permissive licenses for two specific reasons:

1. **It closes the SaaS loophole.** If you modify brain.md and run
   it as a network service for others — hosted, multi-tenant,
   rebranded, whatever — you must publish your modified source under
   the same AGPL. Strong copyleft for a server-side tool means the
   community always gets the improvements back.
2. **It can't be relicensed under a permissive license downstream.**
   Forks stay open forever. Nobody can scoop the project, slap a new
   logo on it, and ship a proprietary "Pro" cut.

You're free to:

- run brain.md, personally or commercially, without limits;
- fork, modify, redistribute, even rebrand — provided your fork stays
  under the AGPL and you publish the source you're running.

You're **not** free to:

- ship a closed-source product based on brain.md;
- host a modified brain.md as a public service without publishing
  your modifications under the AGPL.

### Trademarks

The name **brain.md** and the brain.md logo are *not* covered by the
AGPL. If you fork the project, you're welcome to do almost anything
with the code — but please use your own name and your own mark for
your fork so users aren't confused about which project they're
running.

---

<div align="center">

**brain.md** — your notes, your machine, your agents.

</div>
