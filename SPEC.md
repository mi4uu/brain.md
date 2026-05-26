# SPEC

## §G GOAL
web Obsidian clone. edit `.md` vault from browser & phone. core-plugin parity, no graph.

## §C CONSTRAINTS
- runtime: Bun
- backend: Elysia
- storage: filesystem. vault = dir tree of `.md` + `.media/`
- media path: `<note-dir>/.media/<file>` (same folder as note)
- no graph view
- no Obsidian plugin runtime. only what default Obsidian ships w/o community plugins
- UI ! responsive ≥ 320px (mobile) & desktop
- theme: light & dark. follow `prefers-color-scheme` + manual toggle
- Markdown dialect = Obsidian flavor (CommonMark + GFM + wikilinks + embeds + callouts + math + mermaid + footnotes + tasks + frontmatter + tags)
- no external DB. index = in-mem + on-disk cache (`.brain/index.json`)
- single-user vault per server instance (auth ⊥ in v1)

## §I INTERFACES

### web UI
- `/` → app shell (file tree | editor | preview)
- mobile: drawer file tree, swipe to open
- desktop: 3-pane resizable

### HTTP API (Elysia, JSON)
- `GET  /api/tree` → `{folders:[…], notes:[…]}` full vault tree
- `GET  /api/note/*path` → `{path, content, mtime}` raw md
- `PUT  /api/note/*path` body `{content}` → `{mtime}` upsert
- `DELETE /api/note/*path` → `{ok}`
- `POST /api/rename` body `{from, to}` → `{ok, patchedFiles, totalReplacements}` (rename note + update inbound wikilinks; flat route — Elysia wildcard can't suffix-match `/rename`)
- `POST /api/folder/*path` → `{ok}` mkdir
- `DELETE /api/folder/*path` → `{ok}`
- `POST /api/media/*notePath` multipart `file` → `{url:"/api/media-raw/<dir>/.media/<name>"}`
- `GET  /api/media-raw/*path` → binary stream
- `GET  /api/search?q=…` → `[{path, snippet, score}]`
- `GET  /api/backlinks/*path` → `[{from, lineNo, context}]`
- `GET  /api/resolve?name=…` → `{path}|null` (wikilink target by basename)

### Git API
- `GET  /api/git/status` → `{enabled, head, branch, dirty:bool, lastCommit?:{sha,subject,ts}}`
- `GET  /api/git/log?path=…&limit=N` → `[{sha, subject, ts, author}]` (vault-wide if no path)
- `GET  /api/git/show?sha=…&path=…` → `{content}` (file at sha)
- `GET  /api/git/diff?sha=…&path=…` → `{patch}` (unified diff vs current)
- `POST /api/git/commit` body `{message?}` → `{sha}` (commit pending changes)
- `POST /api/git/restore` body `{path, sha}` → `{ok}` (restore file from sha → write to working tree, autocommit follows)
- `POST /api/git/checkpoint` body `{message}` → `{sha, tag}` (commit + tag `cp-<ts>`)
- env `GIT_AUTOCOMMIT` = `1`/`0` (default `1`)
- env `GIT_AUTOCOMMIT_DEBOUNCE_MS` (default `15000`)

### CLI
- `bun start` → serve `:3000`
- env `VAULT_DIR` = abs path (default `./vault`)
- env `PORT` = `3000`

### filesystem layout
```
<VAULT_DIR>/
  Folder/
    Note.md
    .media/
      img.png
  .brain/
    index.json
```

## §V INVARIANTS

V1: note path ! end `.md`. server rejects ≠.
V2: vault writes ! confined to `VAULT_DIR`. ∀ path → resolve & check prefix. traversal ⊥.
V3: media uploaded for note `<dir>/note.md` → save `<dir>/.media/<file>`. mkdir `.media` if absent.
V4: wikilink `[[Name]]` → resolved by **basename match** across vault. dup basenames → ambiguous, render w/ warn.
V5: rename note → ∀ inbound `[[OldName]]` rewritten to `[[NewName]]` atomically (scan + patch all `.md`).
V6: ∀ API mutation ! atomic. write tmp → rename. partial writes ⊥.
V7: markdown render = Obsidian flavor. ! parse: wikilinks, embeds (`![[…]]`), callouts (`> [!type]`), math (`$..$`, `$$..$$`), mermaid (````mermaid` fence), footnotes, tasks (`- [ ]`/`- [x]`), tags (`#tag`), tables, frontmatter (YAML head `---…---`).
V8: theme toggle persisted in `localStorage`. initial = system pref.
V9: editor saves on debounce 500ms & on blur. unsaved state visible.
V10: mobile layout ≥ 320px width, no horizontal scroll, touch targets ≥ 44px.
V11: index rebuild on startup. incremental on write. `mtime`-based.
V12: media drag-drop into editor → upload → insert `![[file]]` at caret.
V13: file ops never lose data. delete → trash to `.brain/trash/<ts>/` (recoverable).
V14: search = full-text over note bodies + path. case-insensitive. returns top 50.
V15: frontmatter parsed YAML. malformed → show error, do not crash render.
V16: vault dir = git repo (auto `git init` on startup if `GIT_AUTOCOMMIT=1` & `.git` absent). `.brain/`, `node_modules`, `.DS_Store` git-ignored.
V17: autocommit ! coalesce: debounce `GIT_AUTOCOMMIT_DEBOUNCE_MS` after last vault mutation. ≥1 staged change → commit. ⊥ commits else.
V18: git ops ! confined to `VAULT_DIR`. ∀ paths passed to git resolved & checked. shell args ! never interpolated — use argv array.
V19: editor toolbar ∀ actions ! map to deterministic CM6 transactions. no DOM mutation. preserve undo.
V20: toolbar tooltips ! show immediately on hover/focus (no browser delay). toolbar layout ! wrap to multi-row when overflow; ⊥ horizontal scroll on desktop.
V21: editor ↔ preview scroll sync. cursor line in editor → active block in preview (`.active-block`). scroll either pane → other follows. sync ! loop-safe (debounced, reciprocal-fire suppressed).
V22: note row in file tree ! draggable. drop on editor → insert `[[<basename>]]` at caret (no upload). MIME `application/x-brain-note` + text fallback.
V23: `@<query>` typed in editor → autocomplete w/ note basenames. accepting suggestion replaces `@<query>` w/ `[[<chosen>]]`. coexists w/ `[[` trigger.

## §T TASKS

id|status|task|cites
T1|x|scaffold Bun+Elysia repo, bun workspace (server + web)|-
T2|x|filesystem vault adapter: read/write/list, atomic ops|V2,V6,V13
T3|x|API: tree, note CRUD, folder CRUD|I.api,V1,V2
T4|x|API: media upload + serve, `.media/` co-location|I.api,V3
T5|x|API: search full-text|I.api,V14
T6|x|API: rename w/ inbound wikilink patch|I.api,V5
T7|x|API: backlinks endpoint|I.api
T8|x|API: resolve wikilink by basename|I.api,V4
T9|x|index module: build on start, incremental on write, persist `.brain/index.json`|V11
T10|x|web shell: 3-pane desktop, drawer mobile, responsive ≥320px|I.web,V10
T11|x|file explorer tree component: expand/collapse, create/rename/delete|I.web
T12|x|markdown editor (CodeMirror 6): md syntax highlight, wikilink autocomplete, paste-image|I.web,V9,V12
T13|x|markdown renderer (Obsidian flavor) – core: CommonMark + GFM tables + tasks + footnotes|V7
T14|x|renderer: wikilinks `[[…]]` & aliased `[[x\|y]]` clickable|V4,V7
T15|x|renderer: embeds `![[note]]` (transclude) & `![[img.png]]` (media)|V7
T16|x|renderer: callouts `> [!note]/[!warn]/…` styled blocks|V7
T17|x|renderer: math KaTeX inline & block|V7
T18|x|renderer: mermaid fenced blocks|V7
T19|x|renderer: tags `#tag` clickable → filtered view|V7
T20|x|frontmatter YAML parse + show as property panel|V7,V15
T21|x|backlinks panel (per-note) below editor|I.api
T22|x|search UI: command bar, results list, keyboard nav|I.web,V14
T23|x|quick switcher (Ctrl/Cmd+O): fuzzy file open|I.web
T24|x|command palette (Ctrl/Cmd+P): actions|I.web
T25|x|outline panel: headings tree, jump to|I.web
T26|x|bookmarks (star notes), persisted in `.brain/bookmarks.json` (web localStorage)|-
T27|x|theme: CSS vars light & dark, system pref + toggle, persist localStorage|V8
T28|x|mobile UX: touch targets ≥44px, swipe drawer, sticky toolbar, no h-scroll|V10
T29|x|media: upload button in toolbar + drag-drop zone over editor|V12
T30|x|delete → trash dir, restore action|V13
T31|x|tag index + `#tag` filtered note list view|V7
T32|x|tasks across vault aggregated view (default core plugin parity)|V7
T33|x|daily notes: open/create `YYYY-MM-DD.md` in configured folder|-
T34|x|settings panel: vault path display, daily notes folder, editor opts|-
T35|x|PWA manifest + service worker (offline shell, mobile install)|I.web,V10
T36|x|e2e smoke: create note, link, embed image, render, mobile viewport|V7,V10
T37|x|editor toolbar: B/I/S/H1-3, lists, tasks, quote, code, link, wikilink, image, table, math, callout|V19,I.web
T38|x|git wrapper module: init, status, add, commit, log, show, diff, restore, tag|V16,V17,V18
T39|x|autocommit pipeline: debounced after vault mutations, staged-only|V17
T40|x|git API routes: status/log/show/diff/commit/restore/checkpoint|I.git
T41|x|history panel UI per-note: list commits, click → diff & restore|I.web
T42|x|diff viewer (line-level red/green) in modal|I.web
T43|x|manual commit + checkpoint buttons in topbar|I.web
T44|x|settings toggle: enable/disable autocommit, debounce ms|I.web,V17
T45|x|toolbar UX: instant tooltips + wrap layout (no h-scroll)|V20
T46|x|editor ↔ preview scroll & active-line sync|V21
T47|x|drag note from tree → drop in editor → insert wikilink|V22
T48|x|`@` trigger autocomplete for wikilinks|V23
T49|x|folder icon picker: catalog of icons + emoji, persist to `.brain/folder-meta.json`|I.web

## §B BUGS
id|date|cause|fix
