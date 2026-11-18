# Changelog

## 0.8.0 - 2026-11-18

Much better semantic search with a remote embedder, and it degrades to
keyword search instead of failing. Upgrading rebuilds the vector index
once in the background (the prompt format changed); keyword search
answers until it is done.

### Added

- Prompt templates per model: searches and notes are embedded with the
  model's own retrieval prompts, and every chunk carries its note title.
  Known defaults for EmbeddingGemma, Qwen3-Embedding/F2LLM, e5, mmlw,
  bge-en and nomic; both templates can be overridden in Settings. On a
  52-query Polish/English test set, EmbeddingGemma-300M through
  llama-server scores nDCG@10 0.89 against 0.61 for 0.7's bge-small.
- Settings, AI / RAG: **Never send to the embedder**, a list of path
  globs (default `**/secrets/**`). Matching notes are never sent to the
  embedder by any path (indexing, Related, outline, compare, digest,
  orphans) and their old vectors are purged; keyword search still finds
  them. Outline and compare on such a note say it is excluded.
- `BRAINMD_EMBED_API_KEY`: the embedder key from the environment, so it
  can live in a systemd `EnvironmentFile` instead of settings.json. It
  wins over a saved key and the UI shows it as set by the server.
- `eval/retrieval/`: the harness used to choose the embedder, with a
  16-query fixture over the example vault.

### Changed

- When the embedder is down, asleep or slow (4 s per query) or the index
  is being rebuilt, `similar_notes`, `context_for_query` and
  `/api/similar` answer with keyword search, each hit marked
  `"source": "keyword"`; Related and similar tasks return nothing
  instead of an error, and outline, compare, digest and orphans say
  semantic search is unavailable instead of a 500 with the embedder URL.
  The reason shows in the Settings banner and the log (once a minute), so
  a wrong key does not go unnoticed.
- Remote embedder requests go in batches of 8 with a timeout. A note is
  embedded before its old vectors are removed, so an outage never drops
  it from search. A full reindex stops when the embedder goes away and
  the disk sync resumes it later without redoing finished notes; one note
  the embedder rejects no longer blocks the rest.
- Changing the model, endpoint or prompt templates marks the index for a
  rebuild, which now starts on its own at startup.

## 0.7.2 - 2026-11-18

Semantic search forgets deleted notes, and `[[Index]]` from a subfolder
goes to the nearest Index. No config changes needed.

### Fixed

- The vector index kept notes that were deleted or moved outside
  brain.md (mv, git pull, another tool, or while RAG was off). Related,
  `similar_notes`, `context_for_query` and similar tasks kept returning
  them, deleted secret notes included, and Related showed links that
  404. Now:
  - search results drop any note that no longer exists on disk and
    delete its rows on the spot;
  - at startup the store is compared with the disk: rows for missing
    notes are dropped, new or edited notes are re-embedded;
  - every 60 seconds the note index and the vector store are synced with
    the disk, so backlinks and search follow changes made behind
    brain.md's back.

- An ambiguous `[[Index]]` in a subfolder with no Index of its own went
  to the shortest path anywhere in the vault (for example `ludzie/Index`
  from `work/job-search/direct/`). It now goes to the note nearest in the
  folder tree, here `work/job-search/Index`, and only then to the shortest
  path.

## 0.7.1 - 2026-11-18

Log out from the web app, and backlinks that find path links. No config
changes needed.

### Added

- Log out button in the toolbar, shown only when signed in. Its tooltip
  says who is signed in: the email for a Google, GitHub or OIDC login,
  "password" otherwise.
- Settings, Security: "Signed in as" plus a Log out button, for phones
  where tooltips don't show.
- `GET /api/auth/status` returns `user` (`method`, plus `email` and
  `name` for an external login) for a valid session token.

### Fixed

- Logging out reloads the page, so the vault is dropped from memory and
  the login screen shows. Before, nothing in the UI called logout.
- No "Load failed: 401" toast behind the login screen; a session that
  expires mid-use opens the login dialog.
- Backlinks counted only bare `[[name]]` links: `[[folder/note]]`,
  `[[folder/note.md]]` and relative paths were never found, so the
  backlinks panel and MCP `get_backlinks` came back empty for them.
- An ambiguous `[[Index]]` matched every note called Index. Links now
  resolve like Obsidian: full path, path relative to the linking note,
  path suffix, then the name, preferring the linking note's folder and
  then the shortest path, then aliases. Backlinks, the graph, MCP Apps
  and clicking a link in the preview all use this one resolver.

## 0.7.0 - 2026-11-18

Graph view in the web app and in MCP Apps hosts. No config changes
needed.

### Added

- Graph view: notes as nodes, wikilinks as edges, coloured by top-level
  folder. Hover lights up a note's neighbours, click opens it, drag, pan,
  wheel and pinch zoom, filters by folder, tag and name, and a toggle
  for notes without links. Opens from the toolbar.
- Local graph in the sidebar: the current note and its neighbours, one
  or two hops out.
- `GET /api/graph`: nodes and resolved wikilink edges (path, basename
  and alias resolution, deduplicated), filtered by the caller's folder
  permissions; links to unreadable notes are dropped like unresolved
  ones.
- `scripts/gen-demo-vault.ts`: a seeded generator for load-test vaults.
- MCP tool `graph_view` (read-only): the graph of the whole vault, one
  folder, or the notes within `depth` hops of `center`. The model gets a
  short summary (counts, most linked notes); MCP Apps hosts show the
  interactive graph (`ui://brainmd/graph.html`), where a click re-centres
  on a note and "Open in chat" asks the agent to open it. 18 MCP tools
  now.

## 0.6.0 - 2026-11-18

Notes as an interactive view in MCP Apps hosts, and safety annotations
on every MCP tool. No config changes needed; clients without MCP Apps
see no difference.

### Added

- MCP Apps support (`io.modelcontextprotocol/ui`). `read_note` links to a
  `ui://brainmd/note.html` view: the rendered note with clickable
  wikilinks, a back button and backlinks, light and dark from the host.
  The view is one self-contained HTML file (no network), built with the
  web bundle into `web/dist/mcp-apps/`. Hosts without MCP Apps get the
  same text result as before.
- With the view built, `read_note` adds `_meta["brainmd/note-view"]`
  (backlinks and resolved wikilinks, filtered by read permissions), so
  the view needs no extra tool calls. Hosts that ask the user to approve
  each call from a view (OpenClaw) prompt once per note instead of four
  times. `content` is unchanged.
- MCP tool annotations on all 17 tools: `readOnlyHint` on every read and
  search tool, honest `destructiveHint`/`idempotentHint` on `write_note`
  (overwrites; not idempotent, a repeat still bumps mtime) and
  `append_note` (adds, repeats add again). Hosts with an approval mode based on annotations,
  such as OpenClaw's `auto`, can run reads without a prompt and still
  ask before writes. They are hints; folder permissions still decide.
- `write_note` and `append_note` are marked `visibility: ["model"]`, so a
  host that follows the MCP Apps spec will not let a view call them. The
  host enforces this, not brain.md.

### Fixed

- A wikilink to a note with a dot in its name, like `[[brain.md launch]]`
  or `[[Release 0.6]]`, was treated as an attachment and could not be
  opened. An extension now needs 1-10 letters or digits with at least one
  letter.
- `[[#Heading]]` links to a heading in the same note rendered as broken
  in the web preview; they now jump to the heading.

### Changed

- CI runs the web build (including the MCP Apps view) on every PR, not
  only at release.
- `docs/mcp.md` covered 9 tools and an SSE endpoint that no longer exists;
  it now documents all 17 tools, the annotations and MCP Apps.

## 0.5.1 - 2026-11-08

Polish release. No config changes needed.

### Fixed

- The markdown sanitizer dropped `stroke-linecap` and `stroke-linejoin`
  from inline SVG (wrong hast property names in the schema) and
  `aria-hidden` from every element, so KaTeX's visual copy of an equation
  was read out by screen readers next to its MathML copy.

### Changed

- The sanitizer coverage test now checks what its name claims: tags,
  classes, attributes per tag, link and media URLs, and text content all
  survive sanitising for every note in the example vault.
- Added Biome as the linter (`bun run lint`, errors only). CI now runs
  lint and the web test suite next to the server tests and typecheck.
- README: dropped the emoji from headings and table rows; anchor links
  updated to match.

## 0.5.0 - 2026-11-05

Optional OIDC/GitHub login, next to the existing password login. Password
login and passwordless (no auth configured) installs are unaffected unless
you opt in.

### Added

- External login providers (board-plan Part B): generic OIDC and GitHub,
  selected and configured through environment variables:
  - `BRAINMD_OIDC_ISSUER`, `BRAINMD_OIDC_CLIENT_ID`, `BRAINMD_OIDC_CLIENT_SECRET`
    (all three required together), plus optional `BRAINMD_OIDC_NAME`,
    `BRAINMD_OIDC_SCOPES`, `BRAINMD_OIDC_GROUPS_CLAIM`,
    `BRAINMD_OIDC_ALLOWED_GROUPS`.
  - `BRAINMD_GITHUB_CLIENT_ID`, `BRAINMD_GITHUB_CLIENT_SECRET` (both required
    together).
  - `BRAINMD_PUBLIC_URL`: required once either provider above is configured,
    used to build the OAuth redirect URI. Must be `https://` except for
    localhost/127.0.0.1 development.
  - `BRAINMD_OAUTH_ALLOWED_EMAILS`, `BRAINMD_OAUTH_ALLOWED_DOMAINS`: at least
    one allowlist (these, or an OIDC groups claim + allowed groups) is
    required whenever an external provider is configured. **The server
    refuses to start otherwise** (fail closed, not fail open).
- Per-folder permissions, enforced server-side and failing closed on a
  missing or corrupt `folder-meta.json`.
- `__Host-` prefixed session cookies.
- A path-level git attribution audit trail: autocommit records which
  identity (owner, API key, OAuth client, or external login subject)
  touched which path, via `Changed-by` / `On-Behalf-Of` / `Agent` trailers
  on commits that span more than one actor in a single flush.

### Security

- Bumped `@modelcontextprotocol/sdk` 1.29.0 → ^1.32.2 and `elysia` 1.1.25 →
  ^1.4.31 (plus the matching `@elysiajs/cors` peer range): the SDK carried
  several high-severity advisories (OAuth redirect confusion, unbounded
  JSON-RPC batch memory exhaustion, bearer-token audience confusion,
  cross-origin redirect leak; GHSA-6qxp-vccf-f47h, GHSA-22jm-h49p-29qw,
  GHSA-46jr-4wx8-v453, GHSA-rvq5-wwqv-78pq, GHSA-f897-62hf-6gxq), and elysia
  carried a high-severity algorithmic-complexity DoS reachable from
  pre-auth routes.
- Bumped `zod` 3.25.0 → ^4.6.7 (GHSA-mrhx-c7xc-m3w5, unbounded
  memory-exhaustion DoS with no stable 3.x backport), with a root
  `overrides` entry so the SDK's own nested zod resolves to the same
  patched version.
- Closed `192.0.0.0/24`, `192.88.99.0/24` and `198.18.0.0/15` in the CIMD
  SSRF guard's private-IP check, which previously let a `client_id`
  hostname resolve into those IANA special-purpose ranges.
- The login/OAuth-consent rate limiter no longer trusts `X-Forwarded-For`
  by default; it now keys on the real TCP peer unless `BRAINMD_TRUST_PROXY`
  explicitly opts in to a Cloudflare tunnel or a list of trusted proxy IPs.
- Persisted stores (auth, tokens, OAuth) now write through a unique,
  exclusive tmp file and unlink it on any failure in the write itself, not
  only on a failed rename, closing a cross-process clobber and an orphaned
  tmp-file leak.

### Fixed (since the 40 commits on `feat/identity-oauth`)

- `GET /health` no longer returns the vault's absolute filesystem path.
  It was reachable unauthenticated even with a password or an external
  login provider configured.
- Autocommit no longer changes the default git author identity for
  installs that have not configured a password or an external login
  provider. Unconfigured auth commits as `brain.md <brain@local>`, the
  same committer identity v0.4.12 always used, not the new owner-config
  default.
- `Autocommit.flush()` no longer drops a forced rerun request (e.g. a
  second `/api/git/flush` call arriving while a flush is already
  in-flight) when the in-flight flush's own path set turns out empty.

### Upgrading from 0.4.x

- If you have never set a password and never configured an external login
  provider, behaviour is unchanged: the server stays open on the local
  network, same as before.
- If you want external login, set the env vars above. Missing an allowlist
  is a startup error, not a silent open door.
- Password login keeps working exactly as before, whether or not an
  external provider is also configured.
