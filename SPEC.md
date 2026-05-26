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
- theme: light & dark. follow `prefers-color-scheme` + manual toggle. theme pref = device-local (localStorage)
- Markdown dialect = Obsidian flavor (CommonMark + GFM + wikilinks + embeds + callouts + math + mermaid + footnotes + tasks + frontmatter + tags + `==hl==` + `%%comments%%`)
- no external DB. index = in-mem + on-disk cache (`.brain/index.json`)
- single-user vault per server instance (auth ⊥ in v1)
- frontend stack: React 18 + CodeMirror 6 + unified/remark/rehype + highlight.js + KaTeX + mermaid (lazy)
- syntax highlighting: highlight.js, theme via CSS variables
- vault-local config = `<VAULT>/.brain/*.json` (settings, index, folder-meta, trash). env = bootstrap default only
- UI primitives: Radix UI (`@radix-ui/react-*`) — menus, dialogs, tooltips, popovers, tabs, toolbar, switch, toast, scroll-area
- UI vibe = desktop app (compact rows, hairline borders, subtle elevation). ref pattern: terax-ai `src/components/ui/context-menu.tsx` (Radix + Tailwind, dark-first)

## §I INTERFACES

### web UI
- `/` → app shell. grid: topbar / sidebar / main(2-col panes share toolbar row)
- sidebar = vault tree + outline + backlinks. header w/ search + new note + new folder
- toolbar = single row above both panes (editor + preview). format actions emit CM6 tx.
- mobile: drawer file tree, swipe to open, edit/preview tab switch
- all interactive controls (menu, dropdown, context-menu, dialog, popover, tooltip, tabs, toolbar, select, switch, toast, scroll-area) ! Radix-based. local wrappers in `web/src/components/ui/<primitive>.tsx`

### HTTP API (Elysia, JSON)
#### note + folder
- `GET  /api/tree` → `{folders:[…], notes:[…]}` full vault tree
- `GET  /api/note/*path` → `{path, content, mtime}` raw md
- `PUT  /api/note/*path` body `{content}` → `{path, mtime}` upsert
- `DELETE /api/note/*path` → `{ok, trashed}`
- `POST /api/folder/*path` → `{ok}` mkdir
- `DELETE /api/folder/*path` → `{ok, trashed}`
- `POST /api/rename` body `{from, to}` → `{ok, patchedFiles, totalReplacements}` (rename + update inbound wikilinks; flat route — Elysia wildcard can't suffix-match `/rename`)

#### media
- `POST /api/media/*notePath` multipart `file` → `{url, path, name}`
- `GET  /api/media-raw/*path` → binary stream

#### query
- `GET  /api/search?q=…` → `[{path, title, score, snippet, matches}]` top 50
- `GET  /api/backlinks/*path` → `[{from, lineNo, context, embed}]`
- `GET  /api/resolve?name=…` → `{path, matches, source: "path"|"basename"|"alias"|null, ambiguous}` — hierarchy: full path → basename → alias
- `GET  /api/aliases` → `Record<aliasLowercase, paths[]>` (frontmatter aliases)
- `GET  /api/tags` → `[{tag, count}]`
- `GET  /api/tags/notes?tag=X` → `paths[]` (notes containing tag — index.byTag, ! path-substring)
- `GET  /api/tasks` → `[{path, lineNo, done, text}]` aggregate tasks vault-wide

#### trash
- `GET  /api/trash` → `[{path, mtime, isDir}]`
- `POST /api/trash/restore` body `{trashPath}` → `{ok, path}`

#### git
- `GET  /api/git/status` → `{enabled, head, branch, dirty, lastCommit, autocommit:{enabled, debounceMs}}`
- `GET  /api/git/log?path=…&limit=N` → `[{sha, subject, ts, author}]` (vault-wide if no path)
- `GET  /api/git/show?sha=…&path=…` → `{content}`
- `GET  /api/git/diff?sha=…&path=…` → `{patch}` unified diff vs HEAD
- `POST /api/git/commit` body `{message?}` → `{sha|null}`
- `POST /api/git/restore` body `{path, sha}` → `{ok, sha}` (auto-commits "restore X → sha")
- `POST /api/git/checkpoint` body `{message?}` → `{sha, tag:"cp-<ts>"}`
- `POST /api/git/autocommit` body `{enabled?, debounceMs?}` → applies + persists to `.brain/settings.json`
- `POST /api/git/flush` → `{sha|null}` force-fire pending autocommit

#### settings + folder-meta
- `GET  /api/settings` → `{version:1, bookmarks, dailyDir, git:{autocommit, debounceMs}}`
- `PATCH /api/settings` body `{bookmarks?, dailyDir?, git?:{autocommit?, debounceMs?}}` → full settings
- `GET  /api/folder-meta` → `{version:1, icons, colors}`
- `POST /api/folder-meta` body `{path, icon?, color?}` → `{ok, meta}`

### CLI / env
- `bun start` → serve `:3000`
- `VAULT_DIR` = abs path (default `./vault`)
- `PORT` (default `3000`)
- `GIT_AUTOCOMMIT` = `1`/`0` (bootstrap default if no settings.json)
- `GIT_AUTOCOMMIT_DEBOUNCE_MS` (bootstrap default)

### filesystem layout
```
<VAULT_DIR>/
  Folder/
    Note.md
    .media/
      img.png
  .brain/
    index.json          # cached index (mtime-based, rebuilt incrementally)
    settings.json       # per-vault config: bookmarks, dailyDir, git autocommit
    folder-meta.json    # per-folder icons + colors
    trash/<ts>/...      # recoverable deletes
  .git/                  # autocommit history (if GIT_AUTOCOMMIT)
```

## §V INVARIANTS

V1: note path ! end `.md`. server rejects ≠.
V2: vault writes ! confined to `VAULT_DIR`. ∀ path → resolve & check prefix. traversal ⊥.
V3: media uploaded for note `<dir>/note.md` → save `<dir>/.media/<file>`. mkdir `.media` if absent. filename ! contain `/` `\` or start `.`.
V4: wikilink resolve hierarchy: full path `[[Folder/Note]]` → basename `[[Note]]` (case-insensitive) → alias from frontmatter. dup basenames → ambiguous, first wins in render, full path inserted by drag-drop.
V5: rename note → ∀ inbound `[[OldName]]` / `![[OldName]]` / aliased rewritten to `[[NewName]]` atomically (scan + patch all `.md`). section anchors preserved (`#Section`, `^block`).
V6: ∀ API mutation ! atomic. write tmp → rename. partial writes ⊥.
V7: markdown render = Obsidian flavor. ! parse: wikilinks, embeds, callouts, math, mermaid, footnotes, tasks, tags, tables, frontmatter, `==hl==`, `%%cm%%`, image dimensions `![[…|WxH]]`, heading anchors `[[Note#H]]`, raw HTML passthrough, syntax-highlighted code blocks via highlight.js (detect + ignore-missing).
V8: theme toggle persisted in `localStorage` (device-local). initial = system pref. ⊥ persist to vault.
V9: editor saves on debounce 500ms & on blur. unsaved state visible. manual commit/checkpoint ! flush save first.
V10: mobile layout ≥ 320px width, no horizontal scroll, touch targets ≥ 44px.
V11: index rebuild on startup. incremental on write. `mtime`-based. entries hold `aliases` + merged `tags` (inline + frontmatter).
V12: media drag-drop into editor → upload → insert `![[file]]` at caret position (`posAtCoords`).
V13: file ops never lose data. delete → `.brain/trash/<ts>/<path>` (recoverable via `/api/trash/restore`).
V14: search = full-text over title + body + path + tags. case-insensitive. returns top 50.
V15: frontmatter parsed YAML. malformed → show error, do not crash render.
V16: vault dir = git repo (auto `git init` on startup if autocommit enabled & `.git` absent). `.brain/`, `node_modules`, `.DS_Store`, `*.tmp-*` git-ignored.
V17: autocommit ! coalesce: debounce after last vault mutation. ≥1 staged change → commit. ⊥ commits else. flush() ! clearTimeout to prevent post-flush phantom fires.
V18: git ops ! confined to `VAULT_DIR`. ∀ paths passed to git resolved & checked. shell args ! never interpolated — use argv array. GitRepo serialises writes through async mutex to prevent index lock races.
V19: editor toolbar ∀ actions ! map to deterministic CM6 transactions. no DOM mutation. preserve undo.
V20: toolbar tooltips ! show immediately on hover/focus (no browser delay). desktop layout wraps to multi-row when overflow; ⊥ horizontal scroll (mobile fallback = scroll).
V21: editor ↔ preview scroll sync. cursor line in editor → active block in preview (`.active-block`). anchor-aware: active block lands at same viewport Y as cursor when possible. SVG connector path drawn in pane gap, both endpoints visible. loop-safe (debounced, reciprocal-fire suppressed).
V22: note row in file tree ! draggable. drop on editor → insert `[[basename]]` if basename unique vault-wide, else `[[Folder/Subfolder/Name]]`. MIME `application/x-brain-note` + text fallback.
V23: `@<query>` typed in editor → autocomplete w/ note basenames. accepting suggestion replaces `@<query>` w/ `[[<chosen>]]`. coexists w/ `[[` trigger. `startCompletion` force-fired since `@` is not a word char.
V24: embed `![[Note]]` → fetch & inline target body in preview. default-collapsed (max-height ~3em + fade). chevron toggles. recursion guard via visited-set.
V25: click inside `.embed-body` ⊥ move parent editor cursor. clicks on the embed header (outside body) still emit a line-jump for the embed location.
V26: click on preview block w/ `[data-source-line]` (not link/tag/checkbox/embed-body) → editor cursor jumps to that source line. text selection (collapsed=false) suppresses jump.
V27: image / video / audio `src` in standard markdown / raw HTML — if relative (not http/https/data:/abs/anchor) → rewritten to `<note-dir>/.media/<basename>` via `buildMediaUrl`.
V28: rendered headings h1..h6 get slug `id` attr (dedup w/ `-N`). wikilink `[[Note#Heading]]` href = `#/note/<path>#<slug>`. hash listener parses trailing `#<slug>` and scrolls editor + preview to matching heading line.
V29: frontmatter `aliases: [..]` ! resolve sources (in addition to basename). frontmatter `tags: [..]` (or `tag:`) ! merge w/ inline `#tag` into index.tags.
V30: drag from tree → linkTarget = basename if unique vault-wide, else full vault-relative path (no `.md`). Editor drop uses `linkTarget`.
V31: `==text==` (paired, single-line, no `=` inside) ! render `<mark>` in preview. `%%text%%` (inline or multi-line) ! stripped from preview. neither affects raw editor source.
V32: settings persist to `<VAULT>/.brain/settings.json` (atomic write). env vars = bootstrap default only — on load, settings.json overrides env. `bookmarks`, `dailyDir`, `git.autocommit`, `git.debounceMs` persisted per-vault. theme = device-local localStorage.
V33: tag filter view fed by `/api/tags/notes?tag=X` (index.byTag). ! filter by note path substring. tag click in preview navigates to `#/tag/<name>` which loads filtered list.
V34: folder icons selectable from catalog (~30 SVG) or custom emoji `emoji:<char>`. rendered as **badge** over base folder icon (bottom-right corner). picker persists to `.brain/folder-meta.json`.
V35: file tree row supports right-click context menu (note: Open/Rename/Delete; folder: New note / New folder / Set icon / Rename / Delete) + 3-dot button revealing same menu on hover.
V36: active line indicator: editor `.cm-activeLine` + preview `.active-block` share styling (`--bg-hover` + 1px `--accent` bottom box-shadow). SVG path connects both endpoints when both visible.
V37: outline panel = headings tree of current note. click → jump editor + preview to that heading's line.
V38: ∀ interactive overlay/menu/dialog/tooltip/popover/tabs/toolbar/select/toast ! built on Radix Primitives via `web/src/components/ui/*` wrappers. ⊥ ad-hoc DOM widgets, ⊥ raw `contextmenu`/`mousedown`-positioned popups, ⊥ hand-rolled focus traps. a11y (focus mgmt, ARIA, kbd nav, ESC, outside-click) delegated to Radix.
V39: ui wrappers follow terax-ai pattern: `forwardRef` + `cn()` class merge + `data-[state=…]` variants + `data-[side=…]` slide-in. styled w/ Tailwind tokens, theme via CSS vars, dark+light parity verified per primitive.
V40: tooltips instant (delayDuration=0 at provider), match V20. context menu = Radix ContextMenu, not 3rd-party. command palette = Radix Dialog + cmdk inside.
V41: file tree row actions (3-dot menu + folder new-note button) ! visible only on `:hover` / `:focus-within` of the row. inline duplicates of dropdown-menu items ⊥ — ∀ destructive/structural actions live solely in the 3-dot DropdownMenu (T75). label gets full row width minus chevron + icon when row idle, so deep nesting (Journal/aaa/seepdir/deep01.md) stays readable. ref: VSCode + Obsidian tree behaviour.
V42: note + folder basenames ! contain `/`, `\`, `%`, NULL byte, CR, LF, or leading `.`. server rejects 400 INVALID_NAME at create/rename/folder-create/media-upload. client validates the same set in new-note/new-folder/rename prompts before submit (inline error, ! send). vault is POSIX-only: `normalizeRel` ⊥ rewrite `\` to `/` (legitimate `\` in basenames impossible under this rule; rewrite previously silently corrupted such files). Elysia ⊥ auto-decode the `*` wildcard param — ∀ route reading a path-shaped wildcard MUST call `decodeWildcard()` (single `decodeURIComponent`) before passing to vault, so existing pathological files (e.g. `ddd%5C.md`) round-trip correctly: client encodes `%` → `%25`, server decodes once → matches disk.

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
T21|x|backlinks panel (per-note) below editor (later moved to sidebar)|I.api
T22|x|search UI: command bar, results list, keyboard nav|I.web,V14
T23|x|quick switcher (Ctrl/Cmd+O): fuzzy file open|I.web
T24|x|command palette (Ctrl/Cmd+P): actions|I.web
T25|x|outline panel: headings tree, jump to|I.web,V37
T26|x|bookmarks (star notes), persisted in `.brain/settings.json`|V32
T27|x|theme: CSS vars light & dark, system pref + toggle, persist localStorage|V8
T28|x|mobile UX: touch targets ≥44px, swipe drawer, sticky toolbar, no h-scroll|V10
T29|x|media: upload button in toolbar + drag-drop zone over editor|V12
T30|x|delete → trash dir, restore action|V13
T31|x|tag index + `#tag` filtered note list view|V7,V33
T32|x|tasks across vault aggregated view (default core plugin parity)|V7
T33|x|daily notes: open/create `YYYY-MM-DD.md` in configured folder|-
T34|x|settings panel: vault path display, daily notes folder, editor opts|-
T35|x|PWA manifest + service worker (offline shell, mobile install)|I.web,V10
T36|x|e2e smoke: create note, link, embed image, render, mobile viewport|V7,V10
T37|x|editor toolbar: B/I/S/H1-3, lists, tasks, quote, code, link, wikilink, image, table, math, callout|V19,I.web
T38|x|git wrapper module: init, status, add, commit, log, show, diff, restore, tag|V16,V17,V18
T39|x|autocommit pipeline: debounced after vault mutations, staged-only|V17
T40|x|git API routes: status/log/show/diff/commit/restore/checkpoint/flush/autocommit|I.git
T41|x|history panel UI per-note: list commits, click → diff & restore, scope toggle (note/vault)|I.web
T42|x|diff viewer (line-level red/green) in modal|I.web
T43|x|manual commit + checkpoint buttons in topbar (flush save first)|I.web,V9
T44|x|settings toggle: enable/disable autocommit, debounce ms|I.web,V17,V32
T45|x|toolbar UX: instant tooltips + wrap layout (no h-scroll)|V20
T46|x|editor ↔ preview scroll & active-line sync|V21
T47|x|drag note from tree → drop in editor → insert wikilink|V22
T48|x|`@` trigger autocomplete for wikilinks|V23
T49|x|folder icon picker: catalog of icons + emoji, persist to `.brain/folder-meta.json`|V34
T50|x|tag filter view backed by `/api/tags/notes` (index.byTag), not path substring|V33
T51|x|cursor-anchor scroll: active preview block lands at same Y as editor cursor|V21
T52|x|SVG sync connector overlay (bezier between cursor & active block, endpoints)|V21,V36
T53|x|embed transclusion: lazy fetch + render target body in preview, recursion guard|V24
T54|x|embed collapsible: default collapsed, chevron toggle, body max-height + fade|V24
T55|x|click in `.embed-body` ⊥ jump parent editor cursor|V25
T56|x|click preview block (data-source-line) → editor cursor jump (skip if selection)|V26
T57|x|tree context menu (right-click + 3-dot): Open/Rename/Delete + folder New/Set icon|V35
T58|x|folder icon as **badge** over base folder icon (right-bottom)|V34
T59|x|remark plugins: ==highlight== → `<mark>`, %%comment%% → stripped|V31
T60|x|embed dimensions `![[img\|W]]` & `\|WxH`: width/height applied to img/video|V7
T61|x|rehype-headingIds: slug `id` on h1..h6 + dedup. wikilink href `#slug`. hash listener jumps to heading|V28
T62|x|frontmatter aliases + tags integration: index entries hold aliases, resolve uses them; tags merged|V29
T63|x|rehype-relativeMedia: rewrite relative `src` → `<note-dir>/.media/<basename>`|V27
T64|x|drag-drop full path on ambiguous basename (basenameCounts)|V30
T65|x|syntax highlighting in code blocks (rehype-highlight, theme via CSS vars)|V7
T66|x|single shared toolbar above both panes, equal-height pane heads|I.web,V10
T67|x|sidebar header w/ Search + New note + New folder icons|I.web
T68|x|settings.json centralised (bookmarks/dailyDir/git autocommit) w/ atomic persist|V32
T69|x|GitRepo serialise writes via async mutex (prevent autocommit ↔ manual race)|V18
T70|x|IconBare (picker grid) vs FolderIconRender (tree badge) split|V34
T71|x|push initial code to `git@github.com:mi4uu/brain.md.git`|-
T72|x|add radix deps + tailwind v3 + class-variance-authority + clsx + tailwind-merge; `cn()` util in web/src/lib/utils.ts|V38,V39
T73|x|scaffold `web/src/components/ui/` primitives per terax-ai pattern: context-menu, dropdown-menu, dialog, popover, tooltip, tabs, toolbar, select, switch, toast, scroll-area, separator, accordion|V38,V39
T74|x|tree row right-click → Radix ContextMenu (Open/Rename/Delete; folder: New note/folder, Set icon)|V35,V38,V40
T75|x|tree row 3-dot button → Radix DropdownMenu (same items)|V35,V38
T76|x|toolbar tooltips → Radix Tooltip (delayDuration=0)|V20,V38,V40
T77|x|command palette (Cmd/Ctrl+P) → Radix Dialog + cmdk|T24,V38,V40
T78|x|quick switcher (Cmd/Ctrl+O) → Radix Dialog + cmdk|T23,V38
T79|x|settings panel → Radix Dialog + Tabs (vault / editor / git / appearance)|T34,T44,V38
T80|x|history panel + diff viewer → Radix Dialog + ScrollArea|T41,T42,V38
T81|x|folder icon picker → Radix Dialog + ScrollArea (catalog grid + emoji input). spec said Popover but no anchor available; picker invoked from context menu — Dialog preserves UX. revisit if "Set icon" moves inline.|T49,V34,V38
T82|x|switches (autocommit) → Radix Switch. theme = native select, no boolean override needed yet|T27,T44,V38
T83|x|mobile editor/preview tab switch → Radix Tabs|T28,V38
T84|x|toast notifications → Radix Toast (save errors, restore confirm, etc.)|V38
T85|x|editor toolbar shell → Radix Toolbar (root + groups + separators); actions still emit CM6 tx|T37,V19,V38
T86|x|a11y pass: ARIA labels on all icon-only buttons, Icons get aria-hidden+focusable=false, IconBtn helper wraps topbar icons w/ Tooltip+aria-label, ThemeButton+IconPicker labels. axe smoke deferred (no browser harness here)|V38
T87|x|visual pass: compact density on menu items/tabs (py-1.5 → py-1) for desktop-app feel. hairline borders + shadows already token-driven. dark+light parity unchanged. deeper polish (sidebar/topbar tightening, refined accent intensity) deferred until browser-driven review|V39
T88|x|remove legacy widget code: hand-rolled context menu positioning, custom tooltip, custom modal backdrops, custom focus trap|V38

## §B BUGS
id|date|cause|fix
B1|2026-05-24|Elysia wildcard `/api/note/*/rename` greedy — can't suffix-match|§I split → flat `POST /api/rename` body `{from,to}`
B2|2026-05-24|`git log -50 --follow -- path` filter returns nothing if path absent in HEAD — UI showed only "initial"|HistoryPanel scope toggle "this note / all vault"; manual commit flushes editor save first; restore commits explicitly
B3|2026-05-26|autocommit timer fires concurrently w/ manual commit → git index lock contention → 500|GitRepo writeChain mutex; Autocommit.flush clearTimeout. §V17 + §V18
B4|2026-05-26|scroll sync used `el.offsetTop` (offsetParent=body) — preview scrolled to absolute page Y, not container scrollTop|getBoundingClientRect math: `container.scrollTop + (elRect.top − cRect.top)`
B5|2026-05-26|tag click filtered notes by path substring — "no notes with this tag" even when tag present in body|new `/api/tags/notes?tag=X` using `index.byTag`. §V33
B6|2026-05-26|embed `![[Note]]` rendered only header (title), no body|rehype lazy-fetch + inline render of target. recursion guard. §V24
B7|2026-05-26|`@` autocomplete didn't fire — CM6 only auto-triggers on word chars; validFor excluded `@` so popup closed instantly|update listener inspects last typed char; force `startCompletion`. `validFor` regex includes `@`. §V23
B8|2026-05-26|click inside transcluded embed body jumped parent editor cursor to a wrong line (embed body's data-source-line ≠ parent line)|click handler aborts if ancestor is `.embed-body`. §V25
B9|2026-05-26|deeply-nested folder rows (Journal/aaa/seepdir/deep01.md) truncated labels to "deep…" — always-visible 3-dot + pencil + trash + new-note inline buttons consumed row width. VSCode shows the same vault clean.|hide `.tree-actions` until `:hover` / `:focus-within`; remove inline pencil/trash/new-note (already in 3-dot DropdownMenu since T75) so only the 3-dot button surfaces on hover. §V41
B10|2026-05-27|new-note prompt accepted `\` (or `/`) in basename; client/server passed it through; `normalizeRel` rewrote `\`→`/` so the path became traversal-like (e.g. `ddd\.md` → `ddd/.md`); meanwhile a separate encoding step had landed `%5C` literal on disk as `ddd%5C.md`. Every Open/Rename/Delete failed because the rewritten path no longer matched the on-disk filename. Additionally Elysia did NOT URL-decode the `*` wildcard param, so even after the first patch the server saw `ddd%255C.md` literal instead of `ddd%5C.md` — 404.|drop the `\→/` substitution in `normalizeRel`. Add `assertSafeBasename` (server) + `validateBasename` (client) per V42. Add `decodeWildcard()` helper called in every route reading a path-shaped `*` param (notes, folders, backlinks, media, media-raw) so client-encoded `%25` round-trips back to `%`. §V42
