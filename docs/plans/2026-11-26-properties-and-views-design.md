# Properties, views and table editing: design

Status: design agreed in principle, implementation plans in this folder.
Date: 2026-11-26.

## Why

Obsidian users rely on three things brain.md lacks:

1. A **Properties panel**: typed frontmatter edited as rows (name, type icon, value), with `+` to add a key and suggestions from keys already used in the vault.
2. **Bases**: a note or `.base` file that is a live view over notes (table, cards, kanban), filtered, sorted, grouped and with chosen columns. Dataview, Bases' predecessor, has 5.4M downloads; Tasks plus TaskNotes have 7.5M; both are query-over-metadata jobs.
3. **Visual table editing**: click a cell, add a column with `+`, drag rows and columns, align and delete from a context menu. Advanced Tables (3.4M downloads) exists because raw pipe tables are painful.


## Principles

- **Files stay the truth.** Properties live in YAML frontmatter, views live in YAML (`.base` files or a fenced `base` block in a note). No database, no hidden state that matters. The index is a cache.
- **Obsidian-compatible, not Obsidian-identical.** Same frontmatter conventions, same `.base` keys, same expression syntax for the subset we support. A vault opened in both apps keeps working. Keys we do not understand are preserved on every write.
- **Same query for people and agents.** The UI, REST and MCP call one server function. Agents get views for free.
- **Every write is a normal note write.** Property edits, kanban moves and view config changes go through the vault write path, so git attribution, the Changes view, conflict protection (`base_revision`) and folder permissions apply unchanged.
- **Minimal YAML diffs.** Edits touch only the bytes of the key that changed. Comments, key order, quoting, list style, CRLF and values like `007` survive. `yaml`'s `Document.toString()` re-serialises the whole block (checked: it re-indents lists, drops CRLF, turns `007` into `7`), so edits splice the source text by node ranges instead. See Contracts.

## Phase 1: property index, registry, panel

### Index

- `IndexEntry` gains `props: Record<string, PropValue>` (the whole frontmatter mapping, JSON-safe) and `ctime` (file birth time from `stat`, falling back to `mtime`). With the `yaml` core schema, dates stay strings, which is what we want.
- Index snapshot version goes 2 → 3, so old snapshots rebuild.
- `VaultIndex.propertyKeys(allowed?)` returns every key with count, inferred type and up to 20 most common values (for suggestions and select-like editing).

### Type registry

- File: `.brain/types.json`, same shape as Obsidian's `.obsidian/types.json`: `{ "types": { "<name>": "<type>" } }`.
- Types: `text`, `multitext` (list), `number`, `checkbox`, `date`, `datetime`, `tags`, `aliases`. These are Obsidian's names; `multitext` is how Obsidian stores "List". Verify against a real `.obsidian/types.json` when one exists; unknown type strings are read as `text` and written back unchanged.
- Read order: `.brain/types.json`, then `.obsidian/types.json` for keys brain.md has no entry for. brain.md writes only its own file.
- No entry: infer from values across the vault (all booleans → checkbox, all numbers → number, all `YYYY-MM-DD` → date, ISO with time → datetime, any list → multitext, else text). `tags` and `aliases` are fixed.
- One type per name, vault-wide, as in Obsidian. Changing a type never rewrites notes; it only changes how values are edited, sorted and filtered.

### Frontmatter edit module (shared)

- New workspace package `shared/` named `@brainmd/shared`: `package.json` with `"exports": { "./*": "./src/*.ts" }` and `yaml` as its only dependency; root `workspaces` becomes `["shared", "server", "web"]`; server and web depend on `"@brainmd/shared": "workspace:*"`. Checked with a spike: web `tsc`, server `tsc` and runtime, `vite build` and `bun build --compile` all resolve it. A plain relative `../shared` folder does not work: `yaml` is not hoisted to the root `node_modules`, and web's `rootDir` is `src`.
- `@brainmd/shared/frontmatter`, exact contract under Contracts.
- Edit by splice: parse with `parseDocument(src, { keepSourceTokens: true })`; each pair's `value.range` gives `[start, valueEnd, nodeEnd]` offsets into the YAML text. Replace a scalar or flow list between `start` and `valueEnd`; replace a block list the same way but render new items as block lines with the indent and line ending found in the source; delete a pair by removing its whole lines (from the key's line start to the next pair's line start); append a new key as `name: value` lines at the end of the block. Line ending: CRLF when the source has `\r\n`. Scalars are rendered with `yaml`'s `stringify` for that one value, so strings that need quotes get them; wikilinks are always double-quoted (`"[[Note]]"`).
- Round-trip test fixtures: comments, odd spacing, CRLF, BOM, unindented and flow lists, `007`, dates, nested maps (preserved, shown read-only in the panel), invalid YAML (refuse to edit, return the parse error).

### API and MCP

- `GET /api/properties` → `[{ name, type, count, values[] }]`, filtered by read permission.
- `PUT /api/properties/types` `{ name, type }` → writes `.brain/types.json`. Owner only.
- `PATCH /api/note-properties/*` `{ set?, unset?, baseRevision? }` → `vault.mutateNote` with `setProperties`; 409 on revision mismatch, same shape as `PUT /api/note`. Used by views (phase 2) to edit notes that are not open.
- MCP `update_properties` (write perm): `{ path, set?, unset?, base_revision? }`. Agents stop rewriting whole notes to change a status.
- MCP `read_note` response gains `properties` (the parsed mapping) so agents do not parse YAML themselves.

### Properties panel (web)

- Replaces `PropsRender` at the top of the preview. In Editor-only layout it sits above the editor, collapsed to a one-line "Properties (n)" toggle.
- Rows: type icon (click to change type for the vault), name, value editor by type: text input, chip list for multitext/tags/aliases (Enter adds, x removes, suggestions from vault values), number input, checkbox, date and datetime inputs. Nested values are shown read-only with "edit in source".
- `+ Add property`: combobox over vault keys (most used first), typing a new name creates it.
- Keyboard: Up/Down move between rows, Enter edits, Escape leaves, Backspace on an empty name removes the row. Matches the Obsidian keyboard model.
- Edits for the open note are CodeMirror transactions on the frontmatter range, so undo, autosave, the status chip and `base_revision` keep working. With no editor mounted, edit `content` state directly.
- Invalid YAML: panel shows the parse error and a "Fix in source" button that focuses the editor on the frontmatter.

## Phase 2: views (Bases compatible)

### Where views live

- **2a: fenced block in a note.** ```` ```base ```` with `.base` YAML inside. The note is the view, exactly as Obsidian supports. No new file kind: tree, permissions, history, revert, MCP and search work unchanged. This ships first.
- **2b: `.base` files, its own plan after 2a.** The tree lists them, opening one shows the view full-pane with a "Source" toggle for raw YAML, and `![[x.base]]` / `![[x.base#View]]` embed a view in a note. This is bigger than it looks: index events, `listAllNotes`, the tree, Changes/patch/revert and rename are all `.md`-only, and several of those guards are security fixes. Do not loosen `assertMarkdown`; add a separate `assertViewFile` guard (`.base` only) and wire it into exactly the routes that need it.
- brain.md views list **notes only** (`.md`). Obsidian lists every file, attachments included; we can add that later.

### Format (subset of Obsidian Bases)

Confirmed from Obsidian docs and real `.base` files written by Obsidian: top-level `filters`, `formulas`, `properties` (`displayName`), `summaries`, `views`; view keys `type` (`table`, `cards`, `list`, `kanban`, `map`), `name`, `order` (column list), `limit`, `filters`, `groupBy: { property, direction }`, `groupOrder`, `summaries`.

Also confirmed from a file Obsidian wrote after adding a sort, a filter and a group:

```yaml
views:
  - type: table
    name: Table
    filters:
      and:
        - file.size < 200
    groupBy:
      property: file.size
      direction: ASC
    order:
      - file.name
      - file.folder
      - file.embeds
      - file.fullname
      - file.tags
      - file.ext
      - file.basename
    sort:
      - property: file.mtime
        direction: ASC
```

Filter expressions are plain YAML scalars (unquoted when YAML allows it), and the column list may hold `file.*` keys beyond the documented ones (`file.fullname`). Confirmed in a live Obsidian 1.15 vault: a ```` ```base ```` fence in a note renders as a view; a sort added in the toolbar is written back into the fence in place, leaving `filters` and the other views untouched (several sort keys are a list in priority order); Obsidian infers `number` and `date` types from values and writes no `.obsidian/types.json` until a type is changed by hand; `code: 007` is shown as the number 7, so YAML core-schema parsing matches. Confirmed by driving Obsidian 1.15.1 (Linux) over CDP:

- Resizing a column writes `columnSize` under the view, keyed by the property id **with** its prefix even when `order` uses the bare name: `columnSize: { note.status: 184 }`.
- View option keys in the 1.15.1 bundle: table `columnSize`, `rowHeight`; cards `image` (a property id), `imageFit` (`cover` or `contain`), `imageAspectRatio` (number), `cardSize` (number, 50 to 800).
- `.obsidian/types.json` is `{ "types": { "<name>": "<type>" } }`, written when a type is set, and lists the defaults too: `"aliases": "aliases"`, `"cssclasses": "multitext"`, `"tags": "tags"`. List type is `multitext`.
- Obsidian's own frontmatter edit (`processFrontMatter`, the Properties panel path) re-serialises the whole block: it drops comments, turns `[m1, m2]` into an indented block list, `007` into `7`, and collapses spacing. New lists are written as two-space block lists and wikilinks as `"[[x]]"`. So byte-preserving splice edits are stricter than Obsidian, not a compatibility requirement; files Obsidian has touched come back normalised and brain.md must read that form. Unknown keys round-trip untouched, and tests use the files above as fixtures.

Supported in v1: `table`, `cards`, `list`, `kanban`. `map` shows "not supported yet" and keeps its config.

### Expression language (subset)

- Filters are strings or `and` / `or` / `not` trees of strings. Formulas are strings.
- Grammar: literals (string, number, boolean, null), identifiers with optional prefix `note.` / `file.` / `formula.` / `this.`, bracket access `note["x"]`, member and method calls, `!`, `&&`, `||`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`, `%`, parentheses. Pratt parser, no `eval`.
- `file.*`: `name`, `basename`, `fullname`, `path`, `folder`, `ext`, `size`, `ctime`, `mtime`, `tags`, `links`, `backlinks`, `embeds`, `properties`.
- Functions v1: `file.hasTag`, `file.inFolder`, `file.hasLink`, `file.hasProperty`; string `contains`, `containsAll`, `containsAny`, `startsWith`, `endsWith`, `isEmpty`, `lower`, `upper`, `trim`; list `contains`, `containsAll`, `containsAny`, `isEmpty`, `length`; any `isTruthy`, `toString`; global `if`, `now`, `today`, `date`, `link`; date `format` (subset: `YYYY MM DD HH mm`), date `+`/`-` duration strings (`"1 week"`, `"3d"`).
- Unsupported function or syntax: the expression evaluates to null, the view shows a quiet warning line naming it. Never throws, never blanks the view.
- `this` is the note holding the block (2a) or the embedding note, else the `.base` file itself.
- Safety: expressions come from notes and from MCP callers. Member and bracket access read **own properties only** (`Object.hasOwn`), so `__proto__`, `constructor` and the like evaluate to null. Method calls dispatch through an explicit table, never through `obj[name]()`. Evaluation has a step budget per note (10k node visits), so a large vault cannot exhaust a shared budget and drop rows and regexes from expressions are not supported in v1.

### Server query

- `server/src/bases/` : `parse.ts` (YAML to typed config, keeps the raw Document), `expr.ts` (tokenizer, parser, evaluator), `query.ts` (run a view over the index), `functions.ts`.
- `POST /api/bases/query` `{ source: string, view?: string, thisPath?: string, offset?, limit? }` → `{ views: [{ name, type }], view, columns: [{ key, label, type }], groups: [{ key, label, rows: [{ path, title, values }] , count }], total, warnings }`. Rows filtered by the caller's read permission. Default limit 500, max 2000.
- Evaluation runs over `VaultIndex` entries; no file reads. Backlinks come from the index's inbound map.
- Visibility: notes with `hidden: true` or matching hidden globs are left out, as in search and `list_notes`; `search: false` notes are included (they are visible in the tree). The `.base`/view note itself is left out of its own results.
- Permissions: rows are filtered by the caller's read permission. A link to a note the caller cannot read shows as written, like an unresolved link; its resolved path is never shown, and nothing in rows, groups, filters or formulas (`file.links`, `file.hasLink`, `link()`, link properties) tells it apart from a link to a missing note. `file.backlinks` lists only sources the caller can read. (Amended after the final review: dropping such a link from the cell told the caller that the note exists.)
- MCP `query_notes` (read): `{ base?: string (YAML), path?: string (a note or .base holding the view), view?: string, filter?: string, sort?, columns?, limit, offset }`. The simple form (`filter` + `columns`) covers agents that do not write YAML. Paged like the other list tools.

### View UI

- Toolbar like Obsidian: view switcher (name, type icon, result count), Sort, Filter, Properties (columns), `+ New`.
- Changing sort, filters, columns or the view type writes back into the YAML (fence or `.base`) through the same Document-preserving edit, so the view definition is a normal note change in git.
- **Table**: sticky header, column resize, click a cell to edit the property, file name column opens the note, summaries row. A cell edit on a row that is the note open in the editor goes through the editor transaction (same path as the Properties panel), never through `PATCH`, or it would race the unsaved buffer. Other rows go through `PATCH /api/note-properties` with the row's revision.
- **Cards**: grid, title plus the chosen properties, optional cover image property.
- **List**: compact rows.
- **Kanban**: columns from `groupBy.property` and `groupOrder`; drag a card to another column sets that property; drag within a column has no meaning in v1 (no manual order). Empty value column "No value" shown last. `+` in a column creates a note with the property preset.
- **Touch and keyboard.** Phones are first-class clients and `hover: none` has no hover `+` or drag. Every drag has a menu twin: each card and row has a `...` menu with "Move to <column>", and table structure actions live in the same menu. Drag uses native pointer events (no new dependency): desktop drags with the mouse, touch uses the menu.
- `+ New` creates a note in the folder implied by an `inFolder` filter (or the vault root) with properties implied by simple equality filters, then opens it.
- Live: the view re-queries on index changes (existing change feed or a light poll on focus), so an agent's edit shows up.

## Phase 3: table editing

- Pure module `web/src/tables/md-table.ts`: parse GFM table lines into `{ header[], align[], rows[][] }`, serialise with padded columns, operations: insert/delete/move row and column, set alignment, set cell. Escaped pipes (`\|`) handled; a bare pipe inside inline code or `[[note|alias]]` splits the cell, exactly as remark-gfm renders it, so the parser follows the renderer. Tables nested in blockquotes, callouts or lists are out of scope in v1.
- **Editor side** (Advanced Tables parity, highest value per effort): inside a table, Tab / Shift-Tab move to next/previous cell and re-pad the table; Enter moves down a row and adds one at the end; a command "Format table". CodeMirror keymap scoped to table lines.
- **Preview side**: tables get `data-source-line` and `data-source-end`. Hovering shows `+` on the right edge (add column) and bottom edge (add row), drag handles on the header cells and row starts, a context menu (insert above/below/left/right, delete row/column, align left/centre/right, move row up/down, move column left/right). Click a cell to edit inline. Every action computes the new table text and replaces exactly the table's line range: as a CodeMirror transaction when the editor is mounted, otherwise on the `content` state, as the Properties panel does.
- Touch: no hover, so a tap on a cell selects it and shows a small bar with the same actions as the context menu; drag handles are desktop only, the move actions cover touch.
- No change to how tables are stored: plain GFM pipe tables.

## Contracts

Phase plans must use these names and shapes exactly.

```ts
// @brainmd/shared/frontmatter
export type PropValue = string | number | boolean | null | PropValue[] | { [k: string]: PropValue };
export interface FrontmatterRead {
  props: Record<string, PropValue> | null; // null: no frontmatter block
  error: string | null;                    // YAML parse error; edits are refused while set
  range: { from: number; to: number } | null; // char offsets of the whole block incl. both --- lines
}
export function readFrontmatter(content: string): FrontmatterRead;
// Throws FrontmatterError("INVALID_YAML") when the block does not parse
// and FrontmatterError("NOT_A_MAPPING") when it is not a mapping.
export function setProperties(content: string, set: Record<string, PropValue>, unset?: string[]): string;
export function renameProperty(content: string, from: string, to: string): string;
export class FrontmatterError extends Error { code: "INVALID_YAML" | "NOT_A_MAPPING"; }

// @brainmd/shared/property-types
export type PropertyType = "text" | "multitext" | "number" | "checkbox" | "date" | "datetime" | "tags" | "aliases";
export interface TypesFile { types: Record<string, string> } // Obsidian types.json shape
export function inferType(values: PropValue[]): PropertyType;

// server: VaultIndex
interface IndexEntry { /* existing fields */ props: Record<string, PropValue>; ctime: number; }
// IndexData.version: 3
propertyKeys(allowed?: (path: string) => boolean): PropertyInfo[];
interface PropertyInfo { name: string; type: PropertyType; count: number; values: PropValue[] } // values: up to 20, most common first

// REST
// GET   /api/properties                      -> PropertyInfo[]
// PUT   /api/properties/types                { name: string; type: PropertyType } -> { ok: true }   (owner only)
// PATCH /api/note-properties/*               { set?: Record<string, PropValue>; unset?: string[]; baseRevision?: string }
//                                            -> { path, mtime, revision } | 409 { code: "CONFLICT", revision } | 422 { code: "INVALID_YAML", error }

// MCP
// update_properties { path: string; set?: Record<string, PropValue>; unset?: string[]; base_revision?: string }
// read_note result gains: properties: Record<string, PropValue> | null
// query_notes { base?: string; path?: string; view?: string; filter?: string; columns?: string[];
//               sort?: Array<{ property: string; direction: "ASC" | "DESC" }>; limit?: number; offset?: number }

// Phase 2 query
interface BaseQueryRequest { source: string; view?: string; thisPath?: string; offset?: number; limit?: number }
interface BaseQueryResponse {
  views: Array<{ name: string; type: string }>;
  view: string;
  columns: Array<{ key: string; label: string; type: PropertyType | "file" | "formula" }>;
  groups: Array<{ key: string | null; label: string; count: number; rows: Array<{ path: string; title: string; revision: string; values: Record<string, PropValue> }> }>;
  total: number;
  warnings: string[];
}
```

MCP tool count goes from 18 to 20 (`update_properties`, `query_notes`). Update the count and tables in `README.md`, `docs/mcp.md`, `mcp-prompt.md` and `server/src/mcp/instructions.ts` in the task that adds each tool.

## Amendments from planning

Where a plan and the Contracts above differ, the plan wins. Each change below was made while writing the plans against the real code:

- `readFrontmatter` never throws; it returns `error`. Only `setProperties` and `renameProperty` throw `FrontmatterError`.
- `setProperties` on a note with no frontmatter prepends a block; `null` is written as `key:`; a key in both `set` and `unset` is set; `renameProperty` leaves the content unchanged when `to` exists.
- Registry types are applied in `listProperties(vault, index, allowed?)` (`server/src/properties/registry.ts`); `propertyKeys` returns inferred types only. Bad input to the properties routes is a 400 via a new `VaultError` code `INVALID_VALUE`; `NOT_A_MAPPING` is a 422 like `INVALID_YAML`.
- `.brain/types.json` is config, written with `atomicWrite`; it is not a note and does not appear in git history or the Changes view.
- Phase 2a adds `IndexEntry.revision` so each row carries the revision a cell edit sends back; the index snapshot goes to version 4 (Phase 1 sets 3).
- The view-config parser lives in `@brainmd/shared/base-parse` (web and server both need it); view YAML edits live in `@brainmd/shared/base-yaml`.
- Summaries are computed in the web client over the loaded rows (up to 2000); `BaseQueryResponse` has no summary field.
- The step budget is 10k node visits per note, not per query.
- `file.*` values confirmed against a table Obsidian rendered: `file.fullname` is the file name with extension (`Note.md`), `file.basename` drops the extension, `file.name` renders as a link (`.md` hidden, other extensions shown), and `file.folder` is `/` for the vault root.
- One editor-edit helper: Plan 1 introduces `editContent(edit)` in `App.tsx` (CodeMirror transaction over the changed bytes when the editor is mounted, else `setContent`). Plan 3's `onEditTable` and Plan 2a's open-note edits must call it, not add their own. Both panes stay mounted while a note is open (layout modes only toggle CSS), so the fallback is rare.
- Landing order: Plan 1, then Plan 3, then Plan 2a, then Plan 2b. Plans 1 and 3 can be built in parallel worktrees, but merge 1 first and rebase 3 onto it, since both patch `App.tsx` and `Preview.tsx`.

## Plans and size

| Plan | Scope | Rough size |
|---|---|---|
| 1 | shared package, frontmatter splice, index props, types registry, REST, MCP `update_properties`, Properties panel | 1 to 1.5 weeks |
| 2a | expression engine, query, `query_notes`, fenced `base` block with table, cards, list, kanban, view toolbar and write-back | 2 to 3 weeks |
| 2b | `.base` files: guards, tree, open, embed (plan not written yet; it is what opens existing `.base` files) | 1 week |
| 3 | table editing, editor keymap first, then preview actions | 1 week |

Plan 3 is independent and can run in parallel with 1. Plan 2a needs 1.

## Out of scope

Formulas beyond the function list above, map view, calendar view (Obsidian has not shipped it either), manual card order, nested property editing, a plugin runtime, live preview editing.

## Risks

- **YAML round-trip.** The `yaml` Document API keeps comments and order, but re-quoting can still change a line. Mitigation: edit only touched pairs, fixture tests from messy real vaults, and refuse to edit invalid YAML.
- **Expression compatibility.** Obsidian's language is larger than our subset. Mitigation: warnings, never failures; unknown keys preserved.
- **Index size.** Keeping all frontmatter grows `.brain/index.json`. Frontmatter is small next to `body`, which is already stored.
- **Concurrency.** Kanban moves on notes an agent is editing: `base_revision` on every row write; a 409 refreshes the row and shows a short "changed meanwhile" note.
