# Views, Phase 2a (fenced `base` block) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ```` ```base ```` fence in a markdown note renders as a live, editable view (table, cards, list, kanban) over the vault's notes, in Obsidian Bases format, and agents run the same query through `POST /api/bases/query` and the MCP tool `query_notes`.

**Architecture:** One server function, `runBaseQuery`, runs a view over `VaultIndex` entries (no file reads): a Pratt-parsed expression language for filters and formulas, type-aware sort, groupBy, paging, permission filtering. REST and MCP both call it. The renderer turns the fence into a placeholder that `Preview` hydrates with a React view; every view-config change (sort, filter, columns, type, column width) is computed by pure splice functions in `@brainmd/shared/base-yaml` and applied to the fence body as a CodeMirror transaction, so the view definition stays a normal note change. Cell and kanban edits write frontmatter through `PATCH /api/note-properties/*` (or the editor transaction for the open note).

**Tech Stack:** Bun, Elysia, `yaml` 2.x, MCP SDK with zod 4, React 18 (`createRoot`), Radix (dropdown, popover), CodeMirror 6, unified/remark. No new dependency. Tests: `bun test`.

**Spec:** `docs/plans/2026-11-26-properties-and-views-design.md` (section "Phase 2: views", sub-phase 2a only, plus "Principles", "Contracts" and "Out of scope"). Contracts are binding. Phase 1 is `docs/plans/2026-11-26-plan-1-properties.md` and is assumed landed.

## Global Constraints

- Commit steps show the planning session's `Claude-Session:` trailer. The executing session replaces it with its own trailer.
- No em dashes anywhere: code, comments, docs, commit messages, CHANGELOG. Scan before every commit: `git diff --cached | grep -nP "\x{2014}"` must print nothing.
- Comments only for a non-obvious reason, an outside constraint or a workaround. Do not caption what the code says.
- Code, comments, docs and commit messages in English.
- Every commit message ends with this trailer line, after a blank line (a second `-m`): `Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA`
- Contract names, types and routes are exactly those in the spec: `BaseQueryRequest`, `BaseQueryResponse`, `POST /api/bases/query`, MCP `query_notes { base?, path?, view?, filter?, columns?, sort?, limit?, offset? }`. Phase 1 names used as defined in Plan 1: `readFrontmatter`, `setProperties`, `PropValue`, `PropertyType`, `PropertyInfo`, `listProperties(vault, index, allowed?)`, `api.properties()`, `PATCH /api/note-properties/*`, `editContent` in `App.tsx`.
- Expression safety (spec): member and bracket access read own properties only (`Object.hasOwn`); method calls dispatch through an explicit table, never `obj[name]()`; step budget of 10k node visits per note; no regexes from expressions; unsupported function or syntax gives null plus a warning, never a throw.
- Every note write goes through the vault write path (`vault.mutateNote` behind `PATCH /api/note-properties/*`, `api.writeNote`, or the editor). Never loosen `assertMarkdown`. No route in this plan touches a non-`.md` file (`.base` files are plan 2b).
- Phones are first-class: touch targets are 40px at `pointer: coarse`; nothing depends on hover; every drag has a menu twin (`...` menu: "Move to <column>", column menu: sort, move, width, hide).
- UI is quiet and uses existing tokens only (`var(--text-1..4)`, `var(--border)`, `var(--border-strong)`, `var(--bg-surface)`, `var(--bg-surface-2)`, `var(--bg-hover)`, `var(--accent)`, `var(--accent-soft)`, `var(--radius-1..3)`, `var(--space-*)`). No new colours, no new dependency.
- MCP tool count goes 19 (after Phase 1) to 20 (`query_notes`). Update the count and tables in `README.md`, `docs/mcp.md`, `mcp-prompt.md` and `server/src/mcp/instructions.ts` in Task 8.
- `tsconfig` has `noUncheckedIndexedAccess`: index reads are `T | undefined`; use `!` or `?? fallback`.
- Server tests: `cd server && bun test test/<file>`. Web tests: `cd web && bun test test/<file>`. Typecheck: `bun run typecheck` at the repo root. Web build: `bun run --cwd web build`. Do not run `bun install` in the repo.
- Web tests are plain `bun test` with no DOM, so every UI task has a pure `.ts` module that carries the failing test; components are checked by the typecheck and by the screenshot run in Task 19.

## Decisions where the spec was silent or inconsistent

Settled here so executors do not re-decide them.

1. **Row `revision` needs a field the index lacks.** `BaseQueryResponse.rows[].revision` is the sha256 `PATCH /api/note-properties/*` takes as `baseRevision`, and the spec says queries read no files. Task 5 adds `IndexEntry.revision` (taken from `vault.readNote` at index time) and bumps the snapshot version 3 to 4, so old snapshots rebuild once.
2. **The view-config parser lives in `@brainmd/shared/base-parse`**, not only in `server/src/bases/parse.ts`: the web needs the same typed `ViewConfig` to render and to edit. `server/src/bases/parse.ts` re-exports it, so the spec's file list still holds.
3. **`expr.ts` holds the tokenizer and parser; the evaluator is `eval.ts`** with `functions.ts`. Same code the spec describes, split so a reviewer can accept the grammar without the runtime.
4. **Summaries are computed on the web** over the rows a view holds (`BaseQueryResponse` has no summary field and the contract is binding). The web asks for the maximum page (2000), so a summary is complete unless a view matches more than 2000 notes; the footer tooltip says "over the N loaded rows".
5. **A filter that cannot be parsed is ignored with a warning** (`filter ignored (...)`), so one typo does not blank the view. A filter that parses but calls an unsupported function evaluates to null, which fails the row, as the spec says. Inside `and` / `or` / `not` an ignored leaf counts for nothing.
6. **`file.*` values.** Confirmed against a table Obsidian rendered: `file.name` is `Note.md` and the table shows it as a link without `.md`; `file.fullname` is the file name with extension (`Note.md`), not the path; `file.basename` is `Note`; `file.folder` is the folder path, `/` for the vault root; `file.path` is the vault path; `file.ext` is `md`, `file.tags` are tags without `#` (`hasTag` accepts either and matches nested tags), `file.links` are body links that are not embeds, `file.size` is the index `size`. Obsidian's exact `file.name` / `file.fullname` meaning is unconfirmed; the table shows `file.name` as the note's basename, linked.
7. **`this`.** In 2a `this` is the note holding the fence, which is also the one note left out of its own results, so an edit to "the row that is the open note" cannot happen from a 2a view. The editor-transaction path (`host.edit`) is still what a row edit uses when the row is the open note, as the spec says, so 2b can embed a view elsewhere without a new path.
8. **Cards cover image.** Confirmed in the Obsidian 1.15.1 bundle: a view-level `image: <property id>`, plus `imageFit` (`cover` or `contain`), `imageAspectRatio` and `cardSize`. This plan reads `image` and round-trips the others untouched; the query returns the image property in `values` without making it a column.
9. **Column widths** are a view-level `columnSize` map keyed by the prefixed property id, confirmed against Obsidian 1.15.1: resizing `status` writes `note.status: 184` even though `order` lists `status`. `columnId()` in `base-yaml` normalises keys on read and write.
10. **Paging and groups.** `groups[].count` is the group's size after the view `limit` and before paging; `rows` is the page slice. Groups named in `groupOrder` appear even when empty (kanban columns). An ungrouped view returns one group with `key: null` and `label: ""`; the null group of a grouped view has `label: "No value"` and is always last.
11. **Fence write-back** works for top-level fences only. The renderer plugin and `findBaseFences` agree on that: a fence inside a list or blockquote stays a plain code block.
12. **Live refresh** has no server change feed. A mounted view re-queries on window focus, after the open note autosaves (`emitBaseRefresh()` in `onSave`), and after its own writes.
13. **Drag** uses native pointer events for mouse and pen only; touch has the `...` menu. Drop writes the `groupBy` property through the same path as a cell edit. A drag may start on a card's title (it covers most of a small card); the click that follows the release is swallowed so the note does not open.
14. **A view edit remounts the view.** Every edit changes the fence, so `Preview` replaces its HTML and every React root is rebuilt. Three things carry over through `store.ts`: the chosen view, the last result for the block (painted at once, then refetched, so there is no "Loading" flash), and which toolbar popover is open (popovers are controlled and reopen after the edit they just made). Focus does not carry over, which is why keyboard column resize changes only the live width and commits on Enter or blur.
15. **The step budget is per note** (10k node visits for one note's filters, formulas and columns). A per-query budget was rejected: a 13-node filter over about 8000 notes would exhaust it and silently drop the tail rows. A note that runs out during its filters is left out; one that runs out during a column formula keeps its row with empty cells. Either way the response carries one warning (warnings are a Set).

## File Structure

| File | Responsibility |
|---|---|
| `shared/src/base-types.ts` (new) | `BaseQueryRequest`, `BaseQueryResponse`, `FilterNode`, `SortSpec`, `Direction`, limits |
| `shared/src/base-parse.ts` (new) | YAML source to typed `BaseConfig` / `ViewConfig`; errors as warnings |
| `shared/src/base-yaml.ts` (new) | splice edits of a base's YAML (`setViewSort`, `setViewFilters`, `setColumnSize`, `addView`...), `findBaseFences`, `replaceFenceBody` |
| `server/src/bases/parse.ts` (new) | re-export of `base-parse` |
| `server/src/bases/expr.ts` (new) | tokenizer, Pratt parser, `Node` |
| `server/src/bases/functions.ts` (new) | values (`DateValue`, `LinkValue`, `FileObject`), method and global tables, date helpers |
| `server/src/bases/eval.ts` (new) | evaluator with step budget, own-property access |
| `server/src/bases/query.ts` (new) | `runBaseQuery`: filters, formulas, sort, groups, paging, permissions |
| `server/src/bases/simple.ts` (new) | `filter` / `columns` / `sort` to base YAML for MCP |
| `server/src/index/index.ts` | `IndexEntry.revision`, version 4 |
| `server/src/api/bases.ts` (new), `server/src/app.ts` | `POST /api/bases/query` |
| `server/src/mcp/server.ts`, docs | `query_notes` |
| `web/src/renderer/plugins/base.ts` (new), `render.ts` | fence to placeholder |
| `web/src/bases/edit.ts`, `model.ts`, `store.ts`, `new-note.ts` (new) | pure web logic: fence edit, cells, summaries, kanban moves, + New rule, view state cache |
| `web/src/bases/host.ts`, `types.ts`, `CellValue.tsx`, `RowMenu.tsx` (new) | what a view needs from the app; shared layout props; cell display; row menu |
| `web/src/bases/EditableCell.tsx`, `TableView.tsx`, `CardsView.tsx`, `ListView.tsx`, `KanbanView.tsx` (new) | layouts |
| `web/src/bases/BaseToolbar.tsx`, `ToolbarPopovers.tsx`, `BaseView.tsx` (new) | switcher, sort, filter, columns; the view shell |
| `web/src/components/Preview.tsx`, `web/src/App.tsx`, `web/src/api/client.ts` | hydration, host, client methods |
| `web/src/styles/bases.css` (new) | view styles |
| `docs/views.md` (new), `README.md`, `docs/mcp.md`, `CHANGELOG.md` | docs |

---


### Task 1: Shared contracts and the view-config parser

**Files:**
- Create: `shared/src/base-types.ts`, `shared/src/base-parse.ts`, `server/src/bases/parse.ts`
- Test: `server/test/bases.parse.test.ts`

**Interfaces:**
- Consumes: `PropValue` (`@brainmd/shared/frontmatter`), `PropertyType` (`@brainmd/shared/property-types`), both from Phase 1.
- Produces (exact): from `@brainmd/shared/base-types`: `Direction`, `SortSpec { property; direction }`, `FilterNode` (string or `{ and | or | not: FilterNode[] }`), `BaseQueryRequest`, `BaseQueryResponse` (the spec's shapes), `DEFAULT_QUERY_LIMIT = 500`, `MAX_QUERY_LIMIT = 2000`. From `@brainmd/shared/base-parse`: `ViewConfig { type; name; filters?; order: string[]; sort: SortSpec[]; groupBy?: { property; direction }; groupOrder: string[]; limit?; columnSize: Record<string, number>; summaries: Record<string, string>; image? }`, `BaseConfig { filters?; formulas; properties: Record<string, { displayName? }>; summaries; views: ViewConfig[] }`, `ParsedBase { config; warnings: string[]; fatal: boolean }`, `parseBase(source): ParsedBase`, `parseFilter(v, warn)`, `MAX_SOURCE_CHARS = 100000`. Unknown keys are ignored here and survive because edits splice (Task 2) and never re-serialise.

- [ ] **Step 1: Write the failing test**

The two YAML fixtures are files Obsidian wrote (spec, "Format").

```ts
import { describe, expect, test } from "bun:test";
import { parseBase } from "../src/bases/parse";

const ORDER = `views:
  - type: table
    name: Table
    order:
      - file.name
      - file.backlinks
      - cssclasses
      - file.size
  - type: cards
    name: View
`;

const SORT = `views:
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
`;

describe("parseBase on files Obsidian wrote", () => {
  test("column order and a second view", () => {
    const r = parseBase(ORDER);
    expect(r.fatal).toBe(false);
    expect(r.warnings).toEqual([]);
    expect(r.config.views.map((v) => [v.type, v.name])).toEqual([["table", "Table"], ["cards", "View"]]);
    expect(r.config.views[0]!.order).toEqual(["file.name", "file.backlinks", "cssclasses", "file.size"]);
  });

  test("filter, group and sort", () => {
    const v = parseBase(SORT).config.views[0]!;
    expect(v.filters).toEqual({ and: ["file.size < 200"] });
    expect(v.groupBy).toEqual({ property: "file.size", direction: "ASC" });
    expect(v.sort).toEqual([{ property: "file.mtime", direction: "ASC" }]);
    expect(v.order).toContain("file.fullname");
  });
});

describe("parseBase tolerance", () => {
  test("top-level keys, nested filters, formulas, displayName, summaries", () => {
    const r = parseBase(`filters:
  or:
    - file.hasTag("a")
    - not:
        - status == "Done"
formulas:
  late: due < today()
properties:
  status:
    displayName: State
summaries:
  n: Sum
views:
  - type: kanban
    name: Board
    groupBy: { property: status, direction: desc }
    groupOrder: [Todo, Doing, Done]
    limit: 25
    columnSize: { file.name: 240, bad: -1 }
    image: cover
    summaries: { n: Average }
    futureKey: 1
`);
    expect(r.warnings).toEqual([]);
    expect(r.config.filters).toEqual({ or: ['file.hasTag("a")', { not: ['status == "Done"'] }] });
    expect(r.config.formulas.late).toBe("due < today()");
    expect(r.config.properties.status).toEqual({ displayName: "State" });
    expect(r.config.summaries.n).toBe("Sum");
    const v = r.config.views[0]!;
    expect(v.groupBy).toEqual({ property: "status", direction: "DESC" });
    expect(v.groupOrder).toEqual(["Todo", "Doing", "Done"]);
    expect(v.limit).toBe(25);
    expect(v.columnSize).toEqual({ "file.name": 240 });
    expect(v.image).toBe("cover");
    expect(v.summaries.n).toBe("Average");
  });

  test("empty source is a valid base with no views", () => {
    expect(parseBase("")).toMatchObject({ fatal: false, warnings: [], config: { views: [] } });
  });

  test("bad YAML is fatal with a message; wrong shapes only warn", () => {
    const bad = parseBase("views: [");
    expect(bad.fatal).toBe(true);
    expect(bad.warnings[0]).toStartWith("YAML:");
    expect(parseBase("- a\n- b").fatal).toBe(true);
    const odd = parseBase("filters: 5\nviews:\n  - type: 7\n    order: nope\n    sort: [1, {property: x}]\n");
    expect(odd.fatal).toBe(false);
    expect(odd.warnings.length).toBeGreaterThan(0);
    expect(odd.config.views[0]).toMatchObject({ type: "table", order: [], sort: [{ property: "x", direction: "ASC" }] });
  });

  test("__proto__ keys do not pollute", () => {
    const r = parseBase('formulas:\n  __proto__: "1"\nviews: []\n');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(r.config.formulas)).toBeNull();
  });

  test("oversized source is refused", () => {
    expect(parseBase("a: 1\n".repeat(30000)).fatal).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test test/bases.parse.test.ts`
Expected: FAIL, "Cannot find module '../src/bases/parse'".

- [ ] **Step 3: Write the implementation**

`shared/src/base-types.ts`:

```ts
import type { PropValue } from "./frontmatter";
import type { PropertyType } from "./property-types";

export type Direction = "ASC" | "DESC";

export interface SortSpec {
  property: string;
  direction: Direction;
}

export type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] };

export interface BaseQueryRequest {
  source: string;
  view?: string;
  thisPath?: string;
  offset?: number;
  limit?: number;
}

export interface BaseQueryResponse {
  views: Array<{ name: string; type: string }>;
  view: string;
  columns: Array<{ key: string; label: string; type: PropertyType | "file" | "formula" }>;
  groups: Array<{
    key: string | null;
    label: string;
    count: number;
    rows: Array<{ path: string; title: string; revision: string; values: Record<string, PropValue> }>;
  }>;
  total: number;
  warnings: string[];
}

export const DEFAULT_QUERY_LIMIT = 500;
export const MAX_QUERY_LIMIT = 2000;
```

`shared/src/base-parse.ts`:

```ts
import { parse as parseYaml } from "yaml";
import type { Direction, FilterNode, SortSpec } from "./base-types";

export interface ViewConfig {
  type: string;
  name: string;
  filters?: FilterNode;
  order: string[];
  sort: SortSpec[];
  groupBy?: { property: string; direction: Direction };
  groupOrder: string[];
  limit?: number;
  columnSize: Record<string, number>;
  summaries: Record<string, string>;
  image?: string;
}

export interface BaseConfig {
  filters?: FilterNode;
  formulas: Record<string, string>;
  properties: Record<string, { displayName?: string }>;
  summaries: Record<string, string>;
  views: ViewConfig[];
}

export interface ParsedBase {
  config: BaseConfig;
  warnings: string[];
  // YAML that does not parse at all: nothing to run.
  fatal: boolean;
}

export const MAX_SOURCE_CHARS = 100_000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const own = (o: Record<string, unknown>, k: string): unknown => (Object.hasOwn(o, k) ? o[k] : undefined);

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function direction(v: unknown): Direction {
  return typeof v === "string" && /^desc/i.test(v) ? "DESC" : "ASC";
}

export function parseFilter(v: unknown, warn: (m: string) => void, depth = 0): FilterNode | undefined {
  if (typeof v === "string") return v;
  if (depth > 12 || !isRecord(v)) {
    if (v !== undefined && v !== null) warn("a filter must be an expression or an and / or / not list");
    return undefined;
  }
  for (const op of ["and", "or", "not"] as const) {
    const list = own(v, op);
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      warn(`filter "${op}" must be a list`);
      return undefined;
    }
    const kids = list.map((k) => parseFilter(k, warn, depth + 1)).filter((k): k is FilterNode => k !== undefined);
    return { [op]: kids } as FilterNode;
  }
  warn("a filter must be an expression or an and / or / not list");
  return undefined;
}

function stringMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (isRecord(v)) for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
}

function parseView(v: unknown, i: number, warn: (m: string) => void): ViewConfig {
  const o = isRecord(v) ? v : {};
  const type = typeof o.type === "string" ? o.type : "table";
  const sort: SortSpec[] = [];
  for (const s of Array.isArray(o.sort) ? o.sort : []) {
    if (isRecord(s) && typeof s.property === "string") sort.push({ property: s.property, direction: direction(s.direction) });
  }
  const gb = isRecord(o.groupBy) && typeof o.groupBy.property === "string" ? o.groupBy : null;
  const sizes: Record<string, number> = Object.create(null);
  if (isRecord(o.columnSize)) {
    for (const [k, x] of Object.entries(o.columnSize)) {
      if (typeof x === "number" && x > 0) sizes[/^(note|file|formula)\./.test(k) ? k : `note.${k}`] = x;
    }
  }
  const limit = typeof o.limit === "number" && Number.isFinite(o.limit) && o.limit > 0 ? Math.floor(o.limit) : undefined;
  return {
    type,
    name: typeof o.name === "string" && o.name !== "" ? o.name : `${type[0]!.toUpperCase()}${type.slice(1)}${i > 0 ? ` ${i + 1}` : ""}`,
    filters: parseFilter(o.filters, (m) => warn(`view ${i + 1}: ${m}`)),
    order: strings(o.order),
    sort,
    groupBy: gb ? { property: gb.property as string, direction: direction(gb.direction) } : undefined,
    groupOrder: strings(o.groupOrder),
    limit,
    columnSize: sizes,
    summaries: stringMap(o.summaries),
    image: typeof o.image === "string" ? o.image : undefined,
  };
}

export function parseBase(source: string): ParsedBase {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.push(m);
  const empty = (): BaseConfig => ({ formulas: Object.create(null), properties: Object.create(null), summaries: Object.create(null), views: [] });
  if (source.length > MAX_SOURCE_CHARS) return { config: empty(), warnings: ["the view definition is too large"], fatal: true };
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    return { config: empty(), warnings: [`YAML: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`], fatal: true };
  }
  if (raw === null || raw === undefined) return { config: empty(), warnings, fatal: false };
  if (!isRecord(raw)) return { config: empty(), warnings: ["the view definition must be a YAML mapping"], fatal: true };

  const formulas: Record<string, string> = Object.create(null);
  const f = own(raw, "formulas");
  if (isRecord(f)) for (const [k, v] of Object.entries(f)) if (typeof v === "string") formulas[k] = v;

  const properties: BaseConfig["properties"] = Object.create(null);
  const p = own(raw, "properties");
  if (isRecord(p)) {
    for (const [k, v] of Object.entries(p)) {
      if (isRecord(v) && typeof v.displayName === "string") properties[k] = { displayName: v.displayName };
    }
  }

  const viewsRaw = own(raw, "views");
  const views = Array.isArray(viewsRaw) ? viewsRaw.map((v, i) => parseView(v, i, warn)) : [];
  if (viewsRaw !== undefined && !Array.isArray(viewsRaw)) warn('"views" must be a list');

  return {
    config: {
      filters: parseFilter(own(raw, "filters"), warn),
      formulas,
      properties,
      summaries: stringMap(own(raw, "summaries")),
      views,
    },
    warnings,
    fatal: false,
  };
}
```

`server/src/bases/parse.ts`:

```ts
export * from "@brainmd/shared/base-parse";
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `cd server && bun test test/bases.parse.test.ts && cd .. && bun run typecheck`
Expected: PASS (7 tests), typecheck clean. If `@brainmd/shared/base-types` does not resolve, Phase 1's workspace link is missing: check `ls -la web/node_modules/@brainmd server/node_modules/@brainmd`.

- [ ] **Step 5: Commit**

```bash
git add shared/src/base-types.ts shared/src/base-parse.ts server/src/bases/parse.ts server/test/bases.parse.test.ts
git commit -m "feat(bases): shared view contracts and the base YAML parser" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 2: Edit a base's YAML by splice

**Files:**
- Create: `shared/src/base-yaml.ts`
- Test: `server/test/bases.base-yaml.test.ts`

**Interfaces:**
- Consumes: `Direction`, `FilterNode`, `SortSpec` (Task 1); `yaml` (already a dependency of `@brainmd/shared`).
- Produces (exact, all pure `string -> string` over the YAML source of one fence or `.base` file; `view` is the zero-based index into `views`): `class BaseYamlError(code: "INVALID_YAML" | "UNSUPPORTED_STYLE" | "NOT_FOUND" | "CANNOT_DELETE")`, `interface TextEdit { from; to; insert }`, `setPath(src, path: Array<string | number>, value: unknown): string` (`undefined` deletes), `setViewKey`, `setViewSort(src, view, SortSpec[])`, `setViewFilters(src, view, FilterNode | null)`, `setViewOrder(src, view, string[])`, `setViewGroupBy(src, view, { property; direction } | null)`, `setViewType`, `renameView`, `columnId(key)`, `setColumnSize(src, view, column, px)` (writes under `columnId(column)`), `setViewSummary(src, view, column, name | null)`, `setColumnLabel(src, column, label)`, `addView(src, { type; name })`, `deleteView(src, index)`; and for notes: `interface BaseFence { startLine; endLine; closed; indent; from; to; source }`, `findBaseFences(content): BaseFence[]` (1-based lines, `from`/`to` are offsets of the YAML body), `replaceFenceBody(content, fence, source): TextEdit`.

Why splice: `Document.toString()` re-indents lists and drops CRLF. An edit replaces only the changed pair (or the scalar, when old and new are both plain scalars, which keeps a trailing comment), deletes whole lines for a removal, and appends a new pair after the last pair of its map. A scalar that YAML would misread (`!x`, `a: b`, `x # y`) is quoted by `yaml`'s `stringify` for that one value.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import {
  BaseYamlError,
  addView,
  deleteView,
  findBaseFences,
  renameView,
  replaceFenceBody,
  setColumnLabel,
  setColumnSize,
  setPath,
  setViewFilters,
  setViewGroupBy,
  setViewOrder,
  setViewSort,
  setViewSummary,
  setViewType,
} from "@brainmd/shared/base-yaml";

const OBSIDIAN_ORDER = `views:
  - type: table
    name: Table
    order:
      - file.name
      - file.backlinks
      - cssclasses
      - file.size
  - type: cards
    name: View
`;

const OBSIDIAN_SORT = `views:
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
`;

describe("view edits touch only the changed key", () => {
  test("add a sort to the first view, then remove it: byte-identical", () => {
    const withSort = setViewSort(OBSIDIAN_ORDER, 0, [{ property: "file.name", direction: "DESC" }]);
    expect(withSort).toBe(`views:
  - type: table
    name: Table
    order:
      - file.name
      - file.backlinks
      - cssclasses
      - file.size
    sort:
      - property: file.name
        direction: DESC
  - type: cards
    name: View
`);
    expect(setViewSort(withSort, 0, [])).toBe(OBSIDIAN_ORDER);
  });

  test("replace a sort in place, keeping every other key", () => {
    const out = setViewSort(OBSIDIAN_SORT, 0, [{ property: "file.name", direction: "DESC" }]);
    expect(out).toBe(OBSIDIAN_SORT.replace("property: file.mtime\n        direction: ASC", "property: file.name\n        direction: DESC"));
  });

  test("delete groupBy and filters", () => {
    const noGroup = setViewGroupBy(OBSIDIAN_SORT, 0, null);
    expect(noGroup).not.toContain("groupBy");
    expect(noGroup).toContain("- file.size < 200");
    const noFilter = setViewFilters(OBSIDIAN_SORT, 0, null);
    expect(noFilter).not.toContain("filters");
    expect(noFilter).toContain("groupBy:");
  });

  test("replace a column list", () => {
    expect(setViewOrder(OBSIDIAN_ORDER, 0, ["file.name", "status"])).toBe(`views:
  - type: table
    name: Table
    order:
      - file.name
      - status
  - type: cards
    name: View
`);
  });

  test("scalar replacement keeps a trailing comment and unknown keys", () => {
    const src = "# top\nviews:\n  - type: table   # kind\n    name: Table\n    limit: 10 # keep\n    unknown: {a: 1}\nfoo: bar\n";
    expect(setPath(src, ["views", 0, "limit"], 20)).toBe(src.replace("limit: 10", "limit: 20"));
    expect(setViewType(src, 0, "cards")).toBe(src.replace("type: table", "type: cards"));
  });

  test("rename a view and quote a name that YAML would misread", () => {
    expect(renameView(OBSIDIAN_ORDER, 1, "My: board")).toContain('name: "My: board"');
  });

  test("CRLF sources stay CRLF", () => {
    const crlf = OBSIDIAN_ORDER.replace(/\n/g, "\r\n");
    const out = setViewSort(crlf, 0, [{ property: "a", direction: "ASC" }]);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain("sort:\r\n      - property: a\r\n        direction: ASC\r\n");
  });

  test("a source without a trailing newline", () => {
    const src = "views:\n  - type: table\n    name: T";
    expect(setViewSort(src, 0, [{ property: "a", direction: "ASC" }])).toBe(
      "views:\n  - type: table\n    name: T\n    sort:\n      - property: a\n        direction: ASC",
    );
  });
});

describe("expressions that YAML would misread are quoted", () => {
  test("leading !, colon-space and hash", () => {
    const out = setViewFilters(OBSIDIAN_ORDER, 1, {
      and: ['!file.hasTag("a")', "a: b", "x # y", 'status == "Done"', "file.size < 200"],
    });
    expect(out).toContain(`- '!file.hasTag("a")'`);
    expect(out).toContain('- "a: b"');
    expect(out).toContain('- "x # y"');
    expect(out).toContain('- status == "Done"');
    expect(out).toContain("- file.size < 200");
  });

  test("nested and / or / not", () => {
    const out = setViewFilters(OBSIDIAN_ORDER, 0, { and: ["a", { not: ["b"] }] });
    expect(out).toContain("filters:\n      and:\n        - a\n        - not:\n            - b\n");
  });
});

describe("column size and labels", () => {
  test("creates, extends and replaces the columnSize map", () => {
    const a = setColumnSize(OBSIDIAN_SORT, 0, "file.name", 200.4);
    expect(a.endsWith("    columnSize:\n      file.name: 200\n")).toBe(true);
    const b = setColumnSize(a, 0, "status", 120);
    expect(b.endsWith("      file.name: 200\n      note.status: 120\n")).toBe(true);
    expect(setColumnSize(b, 0, "note.status", 130)).toBe(b.replace("note.status: 120", "note.status: 130"));
    expect(setColumnSize(b, 0, "file.name", 300)).toBe(b.replace("file.name: 200", "file.name: 300"));
  });

  test("creates properties.displayName at the top level", () => {
    expect(setColumnLabel(OBSIDIAN_ORDER, "status", "State")).toBe(`${OBSIDIAN_ORDER}properties:\n  status:\n    displayName: State\n`);
  });
});

describe("summaries", () => {
  test("set, change, clear", () => {
    const a = setViewSummary(OBSIDIAN_SORT, 0, "n", "Sum");
    expect(a.endsWith("    summaries:\n      n: Sum\n")).toBe(true);
    const b = setViewSummary(a, 0, "n", "Average");
    expect(b).toBe(a.replace("Sum", "Average"));
    expect(setViewSummary(a, 0, "n", null)).toBe(`${OBSIDIAN_SORT}    summaries:\n`);
  });
});

describe("views list", () => {
  test("add and delete", () => {
    const added = addView(OBSIDIAN_ORDER, { type: "list", name: "List" });
    expect(added).toBe(`${OBSIDIAN_ORDER}  - type: list\n    name: List\n`);
    expect(deleteView(added, 2)).toBe(OBSIDIAN_ORDER);
    expect(deleteView(OBSIDIAN_ORDER, 0)).toBe("views:\n  - type: cards\n    name: View\n");
  });

  test("add to an empty source and next to other top-level keys", () => {
    expect(addView("", { type: "table", name: "Table" })).toBe("views:\n  - type: table\n    name: Table\n");
    expect(addView("filters: x == 1\n", { type: "table", name: "Table" })).toBe(
      "filters: x == 1\nviews:\n  - type: table\n    name: Table\n",
    );
  });
});

describe("refusals", () => {
  test("invalid YAML", () => {
    expect(() => setViewSort("views: [", 0, [])).toThrow(BaseYamlError);
    try {
      setViewSort("views: [", 0, []);
    } catch (e) {
      expect((e as BaseYamlError).code).toBe("INVALID_YAML");
    }
  });

  test("inline (flow) style cannot be spliced", () => {
    try {
      setPath("views: [ {type: table} ]", ["views", 0, "sort"], [1]);
      throw new Error("should refuse");
    } catch (e) {
      expect((e as BaseYamlError).code).toBe("UNSUPPORTED_STYLE");
    }
  });
});

describe("findBaseFences and replaceFenceBody", () => {
  const md =
    "---\ntitle: x\n---\n\nintro\n\n```base\nviews:\n  - type: table\n    name: T\n```\n\n```js\n```base\n```\n\n~~~base\nviews: []\n~~~\n\n```base\n```\n";

  test("finds base fences, skips ones inside other fences, reports 1-based lines", () => {
    const f = findBaseFences(md);
    expect(f.map((x) => [x.startLine, x.endLine, x.closed])).toEqual([
      [7, 11, true],
      [17, 19, true],
      [21, 22, true],
    ]);
    expect(f[0]!.source).toBe("views:\n  - type: table\n    name: T");
    expect(f[1]!.source).toBe("views: []");
  });

  test("replaceFenceBody swaps only the body", () => {
    const f = findBaseFences(md)[0]!;
    const e = replaceFenceBody(md, f, "views:\n  - type: cards\n    name: C\n");
    expect(md.slice(0, e.from) + e.insert + md.slice(e.to)).toBe(
      md.replace("  - type: table\n    name: T", "  - type: cards\n    name: C"),
    );
  });

  test("an empty fence gets a body and a line break", () => {
    const f = findBaseFences(md)[2]!;
    const e = replaceFenceBody(md, f, "views: []");
    expect(md.slice(0, e.from) + e.insert + md.slice(e.to)).toBe(`${md.slice(0, md.lastIndexOf("```base\n```\n"))}\`\`\`base\nviews: []\n\`\`\`\n`);
  });

  test("an unclosed fence runs to the end of the note", () => {
    const f = findBaseFences("a\n```base\nviews: []");
    expect(f).toHaveLength(1);
    expect(f[0]!.closed).toBe(false);
    expect(f[0]!.source).toBe("views: []");
  });

  test("CRLF notes", () => {
    const f = findBaseFences("```base\r\nviews: []\r\n```\r\n");
    expect(f[0]!.source).toBe("views: []");
    const e = replaceFenceBody("```base\r\nviews: []\r\n```\r\n", f[0]!, "a: 1\nb: 2");
    expect(e.insert).toBe("a: 1\r\nb: 2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test test/bases.base-yaml.test.ts`
Expected: FAIL, "Cannot find module '@brainmd/shared/base-yaml'".

- [ ] **Step 3: Write the implementation**

```ts
import { isMap, isScalar, isSeq, parseDocument, stringify, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import type { Direction, FilterNode, SortSpec } from "./base-types";

export class BaseYamlError extends Error {
  constructor(
    readonly code: "INVALID_YAML" | "UNSUPPORTED_STYLE" | "NOT_FOUND" | "CANNOT_DELETE",
    message: string,
  ) {
    super(message);
    this.name = "BaseYamlError";
  }
}

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

const eolOf = (s: string): string => (s.includes("\r\n") ? "\r\n" : "\n");

function lineStart(s: string, pos: number): number {
  return pos <= 0 ? 0 : s.lastIndexOf("\n", pos - 1) + 1;
}

function lineEnd(s: string, pos: number): number {
  const i = s.indexOf("\n", pos);
  if (i < 0) return s.length;
  return s[i - 1] === "\r" ? i - 1 : i;
}

function render(value: unknown): string {
  return stringify(value, { indent: 2, lineWidth: 0, blockQuote: false }).trimEnd();
}

function indentLines(text: string, indent: string, eol: string, skipFirst: boolean): string {
  return text
    .split("\n")
    .map((l, i) => (i === 0 && skipFirst ? l : indent + l))
    .join(eol);
}

type Rng = [number, number, number];
const rangeOf = (n: unknown): Rng | null => ((n as { range?: Rng | null } | null)?.range ?? null);

function keyName(p: Pair): string | null {
  return isScalar(p.key) ? String(p.key.value) : null;
}

// yaml's value range for a block collection runs past the last line break,
// onto the next line; every end offset is pulled back to the last real character.
function trimEnd(src: string, end: number): number {
  let e = end;
  while (e > 0 && /\s/.test(src[e - 1]!)) e--;
  return e;
}

function pairEnd(src: string, p: Pair): number {
  const v = rangeOf(p.value);
  const k = rangeOf(p.key);
  if (v && v[1] > v[0]) return trimEnd(src, v[1]);
  return src.indexOf(":", k ? k[1] : 0) + 1;
}

function parse(src: string) {
  const doc = parseDocument(src, { keepSourceTokens: true });
  if (doc.errors.length > 0) throw new BaseYamlError("INVALID_YAML", doc.errors[0]!.message);
  return doc;
}

export type Path = Array<string | number>;

function nested(rest: string[], value: unknown): unknown {
  return rest.reduceRight<unknown>((acc, k) => ({ [k]: acc }), value);
}

function appendToMap(src: string, map: YAMLMap, rest: string[], value: unknown): string {
  if (map.flow || map.items.length === 0) {
    throw new BaseYamlError("UNSUPPORTED_STYLE", "inline YAML mappings cannot be edited here");
  }
  const eol = eolOf(src);
  const first = rangeOf(map.items[0]!.key)![0];
  const indent = " ".repeat(first - lineStart(src, first));
  const at = lineEnd(src, pairEnd(src, map.items[map.items.length - 1]!));
  const text = indentLines(render(nested(rest, value)), indent, eol, false);
  return src.slice(0, at) + eol + text + src.slice(at);
}

// Sets, replaces or (value undefined) deletes the node at `path`, touching
// only the bytes of that pair. Document.toString() would re-indent and
// re-quote the whole source, so every edit splices by node range instead.
export function setPath(src: string, path: Path, value: unknown): string {
  const doc = parse(src);
  const eol = eolOf(src);
  let node: unknown = doc.contents;
  if (node === null || (isScalar(node) && node.value === null)) {
    if (value === undefined) return src;
    const body = render(nested(path.map(String), value));
    return body.split("\n").join(eol) + eol + (src.trim() === "" ? "" : src);
  }
  for (let i = 0; i < path.length; i++) {
    const key = path[i]!;
    const last = i === path.length - 1;
    if (isSeq(node)) {
      const item = (node as YAMLSeq).items[key as number];
      if (item === undefined) throw new BaseYamlError("NOT_FOUND", `no item ${String(key)}`);
      if (last) throw new BaseYamlError("UNSUPPORTED_STYLE", "use addView or deleteView for list items");
      node = item;
      continue;
    }
    if (!isMap(node)) throw new BaseYamlError("UNSUPPORTED_STYLE", "expected a mapping");
    const map = node as YAMLMap;
    const pair = map.items.find((p) => keyName(p) === String(key));
    if (!pair) {
      if (value === undefined) return src;
      return appendToMap(src, map, path.slice(i).map(String), value);
    }
    const v = pair.value;
    if (!last && (isMap(v) || isSeq(v))) {
      node = v;
      continue;
    }
    const kr = rangeOf(pair.key)!;
    const end = pairEnd(src, pair);
    if (last && value === undefined) {
      const ls = lineStart(src, kr[0]);
      if (src.slice(ls, kr[0]).trim() !== "") {
        throw new BaseYamlError("CANNOT_DELETE", `"${String(key)}" shares a line with a list marker`);
      }
      let le = lineEnd(src, end);
      if (src[le] === "\r") le += 1;
      if (src[le] === "\n") le += 1;
      return src.slice(0, ls) + src.slice(le);
    }
    if (!last && value === undefined) return src;
    const indent = " ".repeat(kr[0] - lineStart(src, kr[0]));
    const text = indentLines(render(nested(path.slice(i).map(String), value)), indent, eol, true);
    const vr = rangeOf(v);
    const plain = last && isScalar(v) && vr && vr[1] > vr[0] && typeof value !== "object" && !String(v.type).startsWith("BLOCK");
    if (plain) {
      const scalar = render(value);
      if (!scalar.includes("\n")) return src.slice(0, vr![0]) + scalar + src.slice(vr![1]);
    }
    return src.slice(0, kr[0]) + text + src.slice(end);
  }
  return src;
}

export const setViewKey = (src: string, view: number, key: string, value: unknown): string =>
  setPath(src, ["views", view, key], value);

export const setViewSort = (src: string, view: number, sort: SortSpec[]): string =>
  setViewKey(src, view, "sort", sort.length > 0 ? sort : undefined);

export const setViewFilters = (src: string, view: number, filters: FilterNode | null): string =>
  setViewKey(src, view, "filters", filters ?? undefined);

export const setViewOrder = (src: string, view: number, order: string[]): string =>
  setViewKey(src, view, "order", order.length > 0 ? order : undefined);

export const setViewGroupBy = (
  src: string,
  view: number,
  groupBy: { property: string; direction: Direction } | null,
): string => setViewKey(src, view, "groupBy", groupBy ?? undefined);

export const setViewType = (src: string, view: number, type: string): string => setViewKey(src, view, "type", type);

export const renameView = (src: string, view: number, name: string): string => setViewKey(src, view, "name", name);

// Obsidian keys columnSize by the prefixed id (`note.status`) even when `order` lists the bare name.
export const columnId = (key: string): string => (/^(note|file|formula)\./.test(key) ? key : `note.${key}`);

export const setColumnSize = (src: string, view: number, column: string, px: number): string =>
  setPath(src, ["views", view, "columnSize", columnId(column)], Math.round(px));

export const setViewSummary = (src: string, view: number, column: string, summary: string | null): string =>
  setPath(src, ["views", view, "summaries", column], summary ?? undefined);

export const setColumnLabel = (src: string, column: string, label: string): string =>
  setPath(src, ["properties", column, "displayName"], label);

export function addView(src: string, view: { type: string; name: string }): string {
  const doc = parse(src);
  const root = doc.contents;
  const views = isMap(root) ? (root as YAMLMap).items.find((p) => keyName(p) === "views")?.value : null;
  if (!isSeq(views)) return setPath(src, ["views"], [view]);
  const seq = views as YAMLSeq;
  if (seq.flow || seq.items.length === 0) {
    throw new BaseYamlError("UNSUPPORTED_STYLE", "inline view lists cannot be edited here");
  }
  const eol = eolOf(src);
  const first = rangeOf(seq.items[0])![0];
  const ls = lineStart(src, first);
  const dash = src.slice(ls, first).lastIndexOf("-");
  const indent = " ".repeat(dash < 0 ? first - ls : dash);
  const lastEnd = trimEnd(src, rangeOf(seq.items[seq.items.length - 1])![1]);
  const at = lineEnd(src, lastEnd);
  return src.slice(0, at) + eol + indentLines(render([view]), indent, eol, false) + src.slice(at);
}

export function deleteView(src: string, index: number): string {
  const doc = parse(src);
  const root = doc.contents;
  const views = isMap(root) ? (root as YAMLMap).items.find((p) => keyName(p) === "views")?.value : null;
  if (!isSeq(views)) throw new BaseYamlError("NOT_FOUND", "no views list");
  const item = (views as YAMLSeq).items[index];
  if (!item) throw new BaseYamlError("NOT_FOUND", `no view ${index}`);
  const r = rangeOf(item)!;
  const ls = lineStart(src, r[0]);
  let le = lineEnd(src, trimEnd(src, r[1]));
  if (src[le] === "\r") le += 1;
  if (src[le] === "\n") le += 1;
  return src.slice(0, ls) + src.slice(le);
}

export interface BaseFence {
  startLine: number;
  endLine: number;
  closed: boolean;
  indent: string;
  from: number;
  to: number;
  source: string;
}

const FM = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function findBaseFences(content: string): BaseFence[] {
  const fm = content.match(FM);
  const lines = content.split("\n");
  const offsets: number[] = [];
  let acc = 0;
  for (const l of lines) {
    offsets.push(acc);
    acc += l.length + 1;
  }
  const out: BaseFence[] = [];
  let i = fm ? fm[0].split("\n").length - (fm[0].endsWith("\n") ? 1 : 0) : 0;
  while (i < lines.length) {
    const open = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/.exec(lines[i]!.replace(/\r$/, ""));
    if (!open) {
      i++;
      continue;
    }
    const indent = open[1]!;
    const marker = open[2]!;
    const isBase = open[3]!.toLowerCase() === "base";
    const closeRe = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}[ \\t]*$`);
    let j = i + 1;
    while (j < lines.length && !closeRe.test(lines[j]!.replace(/\r$/, ""))) j++;
    const closed = j < lines.length;
    if (isBase) {
      const bodyFirst = i + 1;
      const bodyLast = (closed ? j : lines.length) - 1;
      const from = bodyFirst <= bodyLast ? offsets[bodyFirst]! : closed ? offsets[j]! : content.length;
      const to =
        bodyFirst <= bodyLast
          ? offsets[bodyLast]! + lines[bodyLast]!.replace(/\r$/, "").length
          : from;
      const source = bodyFirst <= bodyLast
        ? lines
            .slice(bodyFirst, bodyLast + 1)
            .map((l) => l.replace(/\r$/, "").replace(new RegExp(`^ {0,${indent.length}}`), ""))
            .join("\n")
        : "";
      out.push({ startLine: i + 1, endLine: (closed ? j : lines.length - 1) + 1, closed, indent, from, to, source });
    }
    i = closed ? j + 1 : lines.length;
  }
  return out;
}

export function replaceFenceBody(content: string, fence: BaseFence, source: string): TextEdit {
  const eol = eolOf(content);
  const lines = source.replace(/\s+$/, "").split(/\r?\n/).map((l) => (l === "" ? l : fence.indent + l));
  const empty = fence.from === fence.to;
  return { from: fence.from, to: fence.to, insert: lines.join(eol) + (empty ? eol : "") };
}
```

- [ ] **Step 4: Run the test**

Run: `cd server && bun test test/bases.base-yaml.test.ts`
Expected: PASS (22 tests). The "add a sort, then remove it: byte-identical" test is the one that proves minimal diffs.

- [ ] **Step 5: Commit**

```bash
git add shared/src/base-yaml.ts server/test/bases.base-yaml.test.ts
git commit -m "feat(bases): splice edits for a base's YAML and fence helpers" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 3: Expression tokenizer and parser

**Files:**
- Create: `server/src/bases/expr.ts`
- Test: `server/test/bases.expr.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exact): `type Node` (`lit | id | member | index | call | unary | bin`, see the code), `class ExprError`, `parseExpression(src: string): { ok: true; node: Node } | { ok: false; error: string }`. Never throws. Grammar: string (`"` or `'`, escapes `\\ \" \' \n \t`), number, `true` / `false` / `null`, identifiers (unicode letters, digits, `_`, `$`), `.name`, `[expr]`, `(args)`, prefix `!` and `-`, `* / %`, `+ -`, `< <= > >=`, `== !=`, `&&`, `||`, parentheses. Lambdas (`=>`), `?:`, assignment, object and array literals are errors. Source is capped at 2000 characters and nesting at 64 levels.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { parseExpression, type Node } from "../src/bases/expr";

function ast(src: string): Node {
  const r = parseExpression(src);
  if (!r.ok) throw new Error(r.error);
  return r.node;
}

const num = (v: number): Node => ({ t: "lit", v });
const id = (name: string): Node => ({ t: "id", name });

describe("parseExpression: shape", () => {
  test("literals", () => {
    expect(ast("1.5")).toEqual(num(1.5));
    expect(ast('"a\\"b"')).toEqual({ t: "lit", v: 'a"b' });
    expect(ast("'it\\'s'")).toEqual({ t: "lit", v: "it's" });
    expect(ast("true")).toEqual({ t: "lit", v: true });
    expect(ast("null")).toEqual({ t: "lit", v: null });
  });

  test("precedence and left associativity", () => {
    expect(ast("1 + 2 * 3")).toEqual({ t: "bin", op: "+", l: num(1), r: { t: "bin", op: "*", l: num(2), r: num(3) } });
    expect(ast("10 - 4 - 3")).toEqual({ t: "bin", op: "-", l: { t: "bin", op: "-", l: num(10), r: num(4) }, r: num(3) });
    expect(ast("a || b && c")).toEqual({ t: "bin", op: "||", l: id("a"), r: { t: "bin", op: "&&", l: id("b"), r: id("c") } });
    expect(ast("a < b == c")).toEqual({ t: "bin", op: "==", l: { t: "bin", op: "<", l: id("a"), r: id("b") }, r: id("c") });
    expect(ast("(1 + 2) * 3")).toEqual({ t: "bin", op: "*", l: { t: "bin", op: "+", l: num(1), r: num(2) }, r: num(3) });
  });

  test("unary binds tighter than binary, looser than member access", () => {
    expect(ast("!a.b")).toEqual({ t: "unary", op: "!", arg: { t: "member", obj: id("a"), name: "b" } });
    expect(ast("-3 + 5")).toEqual({ t: "bin", op: "+", l: { t: "unary", op: "-", arg: num(3) }, r: num(5) });
  });

  test("member, index and call chains", () => {
    expect(ast('file.hasTag("x")')).toEqual({
      t: "call",
      callee: { t: "member", obj: id("file"), name: "hasTag" },
      args: [{ t: "lit", v: "x" }],
    });
    expect(ast('note["a b"].length')).toEqual({
      t: "member",
      obj: { t: "index", obj: id("note"), key: { t: "lit", v: "a b" } },
      name: "length",
    });
    expect(ast("now()")).toEqual({ t: "call", callee: id("now"), args: [] });
    expect(ast("f(1, g(2))")).toMatchObject({ t: "call", args: [num(1), { t: "call" }] });
  });

  test("unicode identifiers", () => {
    expect(ast("zażółć")).toEqual(id("zażółć"));
  });
});

describe("parseExpression: refusals", () => {
  test("syntax outside the subset is an error value, never a throw", () => {
    for (const bad of ["1 +", "(1", "a b", "x => x", "a ? b : c", '"open', "file.", "{a: 1}", "f(1,)", "a = 1", "a & b", "", "[1]"]) {
      const r = parseExpression(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  test("depth and length are capped", () => {
    expect(parseExpression(`${"(".repeat(200)}1${")".repeat(200)}`).ok).toBe(false);
    expect(parseExpression(`${"!".repeat(200)}a`).ok).toBe(false);
    expect(parseExpression(`${"1+".repeat(2000)}1`).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test test/bases.expr.test.ts`
Expected: FAIL, "Cannot find module '../src/bases/expr'".

- [ ] **Step 3: Write the implementation**

```ts
export type Node =
  | { t: "lit"; v: null | boolean | number | string }
  | { t: "id"; name: string }
  | { t: "member"; obj: Node; name: string }
  | { t: "index"; obj: Node; key: Node }
  | { t: "call"; callee: Node; args: Node[] }
  | { t: "unary"; op: "!" | "-"; arg: Node }
  | { t: "bin"; op: string; l: Node; r: Node };

export class ExprError extends Error {}

interface Tok {
  k: "num" | "str" | "id" | "op" | "eof";
  v: string | number;
  pos: number;
}

const MAX_SOURCE = 2000;
const MAX_DEPTH = 64;
const OPS = ["&&", "||", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "!", "(", ")", "[", "]", ".", ","];
const ID_RE = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const NUM_RE = /\d+(?:\.\d+)?/y;

function tokenize(src: string): Tok[] {
  if (src.length > MAX_SOURCE) throw new ExprError("expression is too long");
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      let j = i + 1;
      for (;;) {
        if (j >= src.length) throw new ExprError("unterminated string");
        const d = src[j]!;
        if (d === c) break;
        if (d === "\\") {
          const e = src[j + 1];
          s += e === "n" ? "\n" : e === "t" ? "\t" : (e ?? "");
          j += 2;
          continue;
        }
        s += d;
        j++;
      }
      out.push({ k: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    NUM_RE.lastIndex = i;
    const num = NUM_RE.exec(src);
    if (num) {
      out.push({ k: "num", v: Number(num[0]), pos: i });
      i += num[0].length;
      continue;
    }
    ID_RE.lastIndex = i;
    const id = ID_RE.exec(src);
    if (id) {
      out.push({ k: "id", v: id[0], pos: i });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unsupported syntax "${c}" at ${i}`);
    out.push({ k: "op", v: op, pos: i });
    i += op.length;
  }
  out.push({ k: "eof", v: "", pos: src.length });
  return out;
}

const INFIX: Record<string, [number, number]> = {
  "||": [1, 2],
  "&&": [3, 4],
  "==": [5, 6],
  "!=": [5, 6],
  "<": [7, 8],
  "<=": [7, 8],
  ">": [7, 8],
  ">=": [7, 8],
  "+": [9, 10],
  "-": [9, 10],
  "*": [11, 12],
  "/": [11, 12],
  "%": [11, 12],
};
const PREFIX_BP = 13;

class Parser {
  private p = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.p]!;
  }
  private next(): Tok {
    return this.toks[this.p++]!;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === "op" && t.v === v;
  }
  private expectOp(v: string): void {
    const t = this.next();
    if (t.k !== "op" || t.v !== v) throw new ExprError(`expected "${v}" at ${t.pos}`);
  }

  parseAll(): Node {
    const n = this.expr(0, 0);
    const t = this.peek();
    if (t.k !== "eof") throw new ExprError(`unexpected "${String(t.v)}" at ${t.pos}`);
    return n;
  }

  private expr(minBp: number, depth: number): Node {
    if (depth > MAX_DEPTH) throw new ExprError("expression is nested too deeply");
    let lhs = this.prefix(depth);
    for (;;) {
      const t = this.peek();
      if (t.k !== "op") break;
      const op = t.v as string;
      if (op === ".") {
        this.next();
        const name = this.next();
        if (name.k !== "id") throw new ExprError(`expected a name after "." at ${name.pos}`);
        lhs = { t: "member", obj: lhs, name: name.v as string };
        continue;
      }
      if (op === "(") {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(")")) {
          for (;;) {
            args.push(this.expr(0, depth + 1));
            if (this.isOp(",")) {
              this.next();
              continue;
            }
            break;
          }
        }
        this.expectOp(")");
        lhs = { t: "call", callee: lhs, args };
        continue;
      }
      if (op === "[") {
        this.next();
        const key = this.expr(0, depth + 1);
        this.expectOp("]");
        lhs = { t: "index", obj: lhs, key };
        continue;
      }
      const bp = INFIX[op];
      if (!bp || bp[0] < minBp) break;
      this.next();
      const rhs = this.expr(bp[1], depth + 1);
      lhs = { t: "bin", op, l: lhs, r: rhs };
    }
    return lhs;
  }

  private prefix(depth: number): Node {
    const t = this.next();
    if (t.k === "num") return { t: "lit", v: t.v as number };
    if (t.k === "str") return { t: "lit", v: t.v as string };
    if (t.k === "id") {
      if (t.v === "true") return { t: "lit", v: true };
      if (t.v === "false") return { t: "lit", v: false };
      if (t.v === "null") return { t: "lit", v: null };
      return { t: "id", name: t.v as string };
    }
    if (t.k === "op" && (t.v === "!" || t.v === "-")) {
      return { t: "unary", op: t.v, arg: this.expr(PREFIX_BP, depth + 1) };
    }
    if (t.k === "op" && t.v === "(") {
      const n = this.expr(0, depth + 1);
      this.expectOp(")");
      return n;
    }
    throw new ExprError(t.k === "eof" ? "unexpected end of expression" : `unexpected "${String(t.v)}" at ${t.pos}`);
  }
}

export function parseExpression(src: string): { ok: true; node: Node } | { ok: false; error: string } {
  try {
    return { ok: true, node: new Parser(tokenize(src)).parseAll() };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message };
    throw e;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `cd server && bun test test/bases.expr.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/bases/expr.ts server/test/bases.expr.test.ts
git commit -m "feat(bases): expression tokenizer and Pratt parser" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 4: Values, functions and the evaluator

**Files:**
- Create: `server/src/bases/functions.ts`, `server/src/bases/eval.ts`
- Test: `server/test/bases.eval.test.ts`

**Interfaces:**
- Consumes: `Node`, `parseExpression` (Task 3); `PropValue` (Phase 1).
- Produces (exact): from `functions.ts`: `class DateValue(ms, time)`, `class LinkValue(path, display?)`, `class FormulaRoot`, `interface FileData { path; size; ctime; mtime; tags; props }`, `interface FileHost { resolveLink; outLinks; backlinks }`, `class FileObject(data, host)` with `get(name)`, `folder`, `basename`, `type Value`, `UNSUPPORTED`, `truthy`, `looseEq`, `compareValues(a, b): number | null`, `kindOf`, `toStr`, `toProp(v): PropValue` (the JSON-safe cell form: dates as `YYYY-MM-DD` or ISO, links as `[[path]]` without `.md`), `callMethod`, `callGlobal`, `parseDate`, `coerceDate`, `addDuration`. From `eval.ts`: `interface Budget`, `interface Scope extends FnCtx { file; props; thisValue; formula(name); budget }`, `DEFAULT_BUDGET = 10_000` (per note), `evaluate(node, scope): Value` (never throws; at budget exhaustion it warns once and returns null from then on).
- Functions (spec list): `file.hasTag`, `file.inFolder`, `file.hasLink`, `file.hasProperty`; string `contains containsAll containsAny startsWith endsWith isEmpty lower upper trim` and `length`; list `contains containsAll containsAny isEmpty` and `length`; any `isTruthy toString isEmpty`; global `if` (lazy), `now`, `today`, `date`, `link`; date `format` (`YYYY MM DD HH mm`); date `+` / `-` with duration strings (`"1 week"`, `"3d"`, `"1 month 2 hours"`) and date minus date (milliseconds).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { DEFAULT_BUDGET, evaluate, type Scope } from "../src/bases/eval";
import { parseExpression } from "../src/bases/expr";
import { DateValue, FileObject, FormulaRoot, toProp, type FileData, type FileHost, type Value } from "../src/bases/functions";

const NOW = new Date(2026, 10, 26, 9, 30);

function scope(over: Partial<FileData> = {}, extra: Partial<Scope> = {}, warnings: string[] = []): Scope {
  const data: FileData = {
    path: "work/Plan.md",
    size: 120,
    ctime: new Date(2026, 0, 2, 3, 4).getTime(),
    mtime: new Date(2026, 10, 20, 8, 0).getTime(),
    tags: ["project", "work/alpha"],
    props: { status: "Doing", n: 3, done: false, due: "2026-12-01", list: ["a", "b"], link: "[[Other]]" },
    ...over,
  };
  const host: FileHost = {
    resolveLink: (_f, t) => (t.toLowerCase() === "other" ? "work/Other.md" : undefined),
    outLinks: () => [{ text: "Other", path: "work/Other.md", embed: false }, { text: "pic.png", path: null, embed: true }],
    backlinks: () => ["a.md", "b.md"],
  };
  const file = new FileObject(data, host);
  return {
    now: NOW,
    warn: (m) => warnings.push(m),
    file,
    props: data.props,
    thisValue: { x: "T", file },
    formula: () => null,
    budget: { steps: 0, max: DEFAULT_BUDGET, hit: false },
    ...extra,
  };
}

function run(src: string, s: Scope = scope()): Value {
  const p = parseExpression(src);
  if (!p.ok) throw new Error(p.error);
  return evaluate(p.node, s);
}

describe("parser", () => {
  test("precedence and associativity", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("2 * 3 % 4")).toBe(2);
    expect(run("1 < 2 == true")).toBe(true);
    expect(run("true || false && false")).toBe(true);
    expect(run("!false && !false")).toBe(true);
    expect(run("-3 + 5")).toBe(2);
  });

  test("literals and string escapes", () => {
    expect(run('"a\\"b"')).toBe('a"b');
    expect(run("'it\\'s'")).toBe("it's");
    expect(run("1.5")).toBe(1.5);
    expect(run("null")).toBeNull();
  });

  test("errors never throw", () => {
    for (const bad of ["1 +", "(1", "a b", "x =>", "a ? b : c", '"open', "file.", "{a:1}", "f(1,)"]) {
      const p = parseExpression(bad);
      expect(p.ok).toBe(false);
    }
    expect(parseExpression("(".repeat(200) + "1" + ")".repeat(200)).ok).toBe(false);
    expect(parseExpression("1+".repeat(2000) + "1").ok).toBe(false);
  });
});

describe("evaluation: access", () => {
  test("bare names are note properties; prefixes", () => {
    expect(run("status")).toBe("Doing");
    expect(run("note.status")).toBe("Doing");
    expect(run('note["status"]')).toBe("Doing");
    expect(run("nope")).toBeNull();
    expect(run("this.x")).toBe("T");
    expect(run("this.file.name")).toBe("Plan.md");
  });

  test("file properties", () => {
    expect(run("file.name")).toBe("Plan.md");
    expect(run("file.basename")).toBe("Plan");
    expect(run("file.fullname")).toBe("Plan.md");
    expect(run("file.path")).toBe("work/Plan.md");
    expect(run("file.folder")).toBe("work");
    expect(run("file.ext")).toBe("md");
    expect(run("file.size < 200")).toBe(true);
    expect(run("file.tags.length")).toBe(2);
    expect(run("file.backlinks.length")).toBe(2);
    expect(run("file.links.length")).toBe(1);
    expect(run("file.embeds.length")).toBe(1);
    expect(run("file.nope")).toBeNull();
  });

  test("own properties only: prototype names read as null", () => {
    for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"]) {
      expect(run(`note["${k}"]`)).toBeNull();
      expect(run(`this["${k}"]`)).toBeNull();
      expect(run(`file["${k}"]`)).toBeNull();
    }
    const s = scope({ props: JSON.parse('{"__proto__": "own", "ok": 1}') });
    expect(run('note["__proto__"]', s)).toBe("own");
    expect(run("ok", s)).toBe(1);
  });

  test("method dispatch is a table, not obj[name]()", () => {
    const w: string[] = [];
    expect(run('status.constructor("x")', scope({}, {}, w))).toBeNull();
    expect(w).toEqual(['unsupported function "constructor"']);
    expect(run('"x".__proto__()', scope({}, {}, w))).toBeNull();
    expect(run("file.hasOwnProperty()", scope({}, {}, w))).toBeNull();
  });
});

describe("evaluation: operators", () => {
  test("comparison and equality", () => {
    expect(run('status == "Doing"')).toBe(true);
    expect(run('status != "Doing"')).toBe(false);
    expect(run("n >= 3 && n <= 3")).toBe(true);
    expect(run('n < "x"')).toBe(false);
    expect(run("missing == null")).toBe(true);
    expect(run("list == list")).toBe(true);
  });

  test("arithmetic corner cases", () => {
    expect(run("1 / 0")).toBeNull();
    expect(run("5 % 0")).toBeNull();
    expect(run('"a" + 1')).toBe("a1");
    expect(run('"a" + missing')).toBeNull();
    expect(run("n * 2")).toBe(6);
    expect(run("true + 1")).toBeNull();
  });

  test("short circuit does not evaluate the right side", () => {
    const w: string[] = [];
    run("false && nope()", scope({}, {}, w));
    expect(w).toEqual([]);
  });
});

describe("functions", () => {
  test("file functions", () => {
    expect(run('file.hasTag("project")')).toBe(true);
    expect(run('file.hasTag("#PROJECT")')).toBe(true);
    expect(run('file.hasTag("work")')).toBe(true);
    expect(run('file.hasTag("other", "work/alpha")')).toBe(true);
    expect(run('file.hasTag("wor")')).toBe(false);
    expect(run('file.inFolder("work")')).toBe(true);
    expect(run('file.inFolder("wor")')).toBe(false);
    expect(run('file.inFolder("")')).toBe(true);
    expect(run('file.hasLink("Other")')).toBe(true);
    expect(run('file.hasLink("[[other]]")')).toBe(true);
    expect(run('file.hasLink("Nope")')).toBe(false);
    expect(run('file.hasProperty("status")')).toBe(true);
    expect(run('file.hasProperty("constructor")')).toBe(false);
  });

  test("string functions", () => {
    expect(run('status.contains("oin")')).toBe(true);
    expect(run('status.containsAll("D", "g")')).toBe(true);
    expect(run('status.containsAny("x", "D")')).toBe(true);
    expect(run('status.startsWith("Do")')).toBe(true);
    expect(run('status.endsWith("ng")')).toBe(true);
    expect(run("status.isEmpty()")).toBe(false);
    expect(run('"  Hi ".trim().lower()')).toBe("hi");
    expect(run("status.upper()")).toBe("DOING");
    expect(run("status.length")).toBe(5);
  });

  test("list and any functions", () => {
    expect(run('list.contains("a")')).toBe(true);
    expect(run('list.containsAll("a", "b")')).toBe(true);
    expect(run('list.containsAny("z", "b")')).toBe(true);
    expect(run("list.isEmpty()")).toBe(false);
    expect(run("list.length")).toBe(2);
    expect(run("missing.isEmpty()")).toBe(true);
    expect(run("n.isTruthy()")).toBe(true);
    expect(run("missing.isTruthy()")).toBe(false);
    expect(run("n.toString()")).toBe("3");
    expect(run("list.toString()")).toBe("a, b");
  });

  test("if is lazy; link, date, now, today", () => {
    const w: string[] = [];
    expect(run('if(n > 2, "big", nope())', scope({}, {}, w))).toBe("big");
    expect(w).toEqual([]);
    expect(run('if(n > 5, "big")')).toBeNull();
    expect(toProp(run('link("Plan", "x")'))).toBe("[[Plan]]");
    expect(toProp(run("today()"))).toBe("2026-11-26");
    expect(toProp(run("now()"))).toMatch(/^2026-11-2[56]T/);
    expect(run('date("2026-02-30")')).toBeNull();
    expect(run('date("2026-12-01") == due')).toBe(true);
  });

  test("dates: compare, format, add and subtract durations", () => {
    expect(run("due > today()")).toBe(true);
    expect(run('due < today() + "3d"')).toBe(false);
    expect(run('due < today() + "1 week"')).toBe(true);
    expect(run('today() + "3d" == date("2026-11-29")')).toBe(true);
    expect(run('(today() - "1 week").format("YYYY-MM-DD")')).toBe("2026-11-19");
    expect(run('now().format("YYYY/MM/DD HH:mm")')).toBe("2026/11/26 09:30");
    expect(run('(today() + "1 month").format("MM")')).toBe("12");
    expect(run('today() + "2 hours"')).toBeInstanceOf(DateValue);
    expect(run('date("2026-12-01") - date("2026-11-30")')).toBe(86400000);
    const w: string[] = [];
    expect(run('today() + "soon"', scope({}, {}, w))).toBeNull();
    expect(w).toEqual(['invalid duration "soon"']);
  });

  test("unsupported function: null plus a warning, never a throw", () => {
    const w: string[] = [];
    expect(run('sum(1, 2) + "x"', scope({}, {}, w))).toBeNull();
    expect(run("list.map(1)", scope({}, {}, w))).toBeNull();
    expect(w).toEqual(['unsupported function "sum"', 'unsupported function "map"']);
  });

  test("formulas resolve through the scope", () => {
    const s = scope({}, { formula: (n) => (n === "double" ? 6 : null) });
    expect(run("formula.double + 1", s)).toBe(7);
    expect(run("formula.missing", s)).toBeNull();
    expect(new FormulaRoot()).toBeDefined();
  });
});

describe("step budget", () => {
  test("stops runaway evaluation with one warning", () => {
    const w: string[] = [];
    const s = scope({}, { budget: { steps: 0, max: 50, hit: false } }, w);
    const src = Array.from({ length: 80 }, () => "1").join(" + ");
    expect(run(src, s)).toBeNull();
    expect(run("1 + 1", s)).toBeNull();
    expect(w).toEqual(["evaluation budget exceeded for a note; its remaining expressions were skipped"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test test/bases.eval.test.ts`
Expected: FAIL, "Cannot find module '../src/bases/eval'".

- [ ] **Step 3: Write the implementation**

`server/src/bases/functions.ts`:

```ts
import type { PropValue } from "@brainmd/shared/frontmatter";

export class DateValue {
  constructor(
    readonly ms: number,
    readonly time: boolean,
  ) {}
}

export class LinkValue {
  constructor(
    readonly path: string,
    readonly display?: string,
  ) {}
}

export class FormulaRoot {}

export interface FileData {
  path: string;
  size: number;
  ctime: number;
  mtime: number;
  tags: string[];
  props: Record<string, PropValue>;
}

export interface FileHost {
  resolveLink(fromPath: string, target: string): string | undefined;
  // Links the caller may see: a link to a note the caller cannot read is gone.
  outLinks(path: string): Array<{ text: string; path: string | null; embed: boolean }>;
  backlinks(path: string): string[];
}

export class FileObject {
  private cache = new Map<string, Value>();
  constructor(
    readonly data: FileData,
    readonly host: FileHost,
  ) {}

  get folder(): string {
    const i = this.data.path.lastIndexOf("/");
    return i < 0 ? "" : this.data.path.slice(0, i);
  }

  get basename(): string {
    const base = this.data.path.slice(this.data.path.lastIndexOf("/") + 1);
    return base.replace(/\.md$/i, "");
  }

  get(name: string): Value {
    const hit = this.cache.get(name);
    if (hit !== undefined) return hit;
    const v = this.compute(name);
    this.cache.set(name, v);
    return v;
  }

  private compute(name: string): Value {
    const d = this.data;
    switch (name) {
      case "name":
        return `${this.basename}.md`;
      case "basename":
        return this.basename;
      case "fullname":
        return `${this.basename}.md`;
      case "path":
        return d.path;
      case "folder":
        // Obsidian shows the vault root as "/".
        return this.folder === "" ? "/" : this.folder;
      case "ext":
        return "md";
      case "size":
        return d.size;
      case "ctime":
        return new DateValue(d.ctime, true);
      case "mtime":
        return new DateValue(d.mtime, true);
      case "tags":
        return [...d.tags];
      case "links":
        return this.host.outLinks(d.path).filter((l) => !l.embed).map((l) => new LinkValue(l.path ?? l.text));
      case "embeds":
        return this.host.outLinks(d.path).filter((l) => l.embed).map((l) => new LinkValue(l.path ?? l.text));
      case "backlinks":
        return this.host.backlinks(d.path).map((p) => new LinkValue(p));
      case "properties":
        return d.props as Value;
      default:
        return null;
    }
  }
}

export type Value = null | boolean | number | string | Value[] | { [k: string]: Value } | DateValue | LinkValue | FileObject | FormulaRoot;

export const UNSUPPORTED = Symbol("unsupported");

export interface FnCtx {
  now: Date;
  warn(message: string): void;
}

export type Kind = "null" | "boolean" | "number" | "string" | "list" | "object" | "date" | "link" | "file" | "other";

export function kindOf(v: Value): Kind {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (Array.isArray(v)) return "list";
  if (v instanceof DateValue) return "date";
  if (v instanceof LinkValue) return "link";
  if (v instanceof FileObject) return "file";
  if (v instanceof FormulaRoot) return "other";
  return "object";
}

export function truthy(v: Value): boolean {
  switch (kindOf(v)) {
    case "null":
      return false;
    case "boolean":
      return v as boolean;
    case "number":
      return (v as number) !== 0 && !Number.isNaN(v);
    case "string":
      return (v as string) !== "";
    case "list":
      return (v as Value[]).length > 0;
    default:
      return true;
  }
}

const stripMd = (p: string): string => p.replace(/\.md$/i, "");

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

export function formatDate(d: DateValue, fmt: string): string {
  const x = new Date(d.ms);
  const parts: Record<string, string> = {
    YYYY: pad(x.getFullYear(), 4),
    MM: pad(x.getMonth() + 1),
    DD: pad(x.getDate()),
    HH: pad(x.getHours()),
    mm: pad(x.getMinutes()),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm/g, (t) => parts[t]!);
}

export function parseDate(s: string): DateValue | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s.trim());
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hasTime = m[4] !== undefined;
  const probe = new Date(y, mo - 1, da);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== da) return null;
  if (!hasTime) return new DateValue(probe.getTime(), false);
  if (m[7]) return new DateValue(Date.parse(s.trim().replace(" ", "T")), true);
  return new DateValue(new Date(y, mo - 1, da, Number(m[4]), Number(m[5]), Number(m[6] ?? 0)).getTime(), true);
}

export function coerceDate(v: Value): DateValue | null {
  if (v instanceof DateValue) return v;
  if (typeof v === "string") return parseDate(v);
  return null;
}

const UNIT: Record<string, "y" | "M" | "w" | "d" | "h" | "m" | "s"> = {
  y: "y", year: "y", years: "y",
  M: "M", month: "M", months: "M",
  w: "w", week: "w", weeks: "w",
  d: "d", day: "d", days: "d",
  h: "h", hour: "h", hours: "h",
  m: "m", min: "m", mins: "m", minute: "m", minutes: "m",
  s: "s", sec: "s", secs: "s", second: "s", seconds: "s",
};

export function addDuration(d: DateValue, spec: string, sign: 1 | -1): DateValue | null {
  const re = /(\d+(?:\.\d+)?)\s*([A-Za-z]+)/g;
  const x = new Date(d.ms);
  let time = d.time;
  let consumed = 0;
  let any = false;
  for (const m of spec.trim().matchAll(re)) {
    const unit = UNIT[m[2]!];
    if (!unit) return null;
    any = true;
    consumed += m[0].length;
    const n = Number(m[1]) * sign;
    if (unit === "y") x.setFullYear(x.getFullYear() + n);
    else if (unit === "M") x.setMonth(x.getMonth() + n);
    else if (unit === "w") x.setDate(x.getDate() + n * 7);
    else if (unit === "d") x.setDate(x.getDate() + n);
    else {
      time = true;
      x.setTime(x.getTime() + n * (unit === "h" ? 3600000 : unit === "m" ? 60000 : 1000));
    }
  }
  if (!any || consumed < spec.replace(/[\s,]/g, "").length) return null;
  return new DateValue(x.getTime(), time);
}

export function toStr(v: Value): string {
  switch (kindOf(v)) {
    case "null":
      return "";
    case "list":
      return (v as Value[]).map(toStr).join(", ");
    case "date":
      return toProp(v) as string;
    case "link":
      return `[[${stripMd((v as LinkValue).path)}]]`;
    case "file":
      return (v as FileObject).data.path;
    case "object":
      return JSON.stringify(toProp(v));
    case "other":
      return "";
    default:
      return String(v);
  }
}

// JSON-safe form of any value: what a query puts in a cell.
export function toProp(v: Value, depth = 0): PropValue {
  if (depth > 6) return null;
  switch (kindOf(v)) {
    case "null":
    case "other":
      return null;
    case "date": {
      const d = v as DateValue;
      return d.time ? new Date(d.ms).toISOString() : formatDate(d, "YYYY-MM-DD");
    }
    case "link":
      return `[[${stripMd((v as LinkValue).path)}]]`;
    case "file":
      return `[[${stripMd((v as FileObject).data.path)}]]`;
    case "list":
      return (v as Value[]).map((x) => toProp(x, depth + 1));
    case "object": {
      const out: Record<string, PropValue> = Object.create(null);
      for (const k of Object.keys(v as object)) out[k] = toProp((v as Record<string, Value>)[k]!, depth + 1);
      return out;
    }
    default:
      return v as PropValue;
  }
}

function linkKey(v: Value): string | null {
  if (v instanceof LinkValue) return v.path;
  if (v instanceof FileObject) return v.data.path;
  return null;
}

export function looseEq(a: Value, b: Value): boolean {
  if (a === null || b === null) return a === b;
  const da = a instanceof DateValue ? a : null;
  const db = b instanceof DateValue ? b : null;
  if (da || db) {
    const x = coerceDate(a);
    const y = coerceDate(b);
    return x !== null && y !== null && x.ms === y.ms;
  }
  const la = linkKey(a);
  const lb = linkKey(b);
  if (la !== null || lb !== null) return la !== null && la === lb;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => looseEq(x, b[i]!));
  }
  return a === b;
}

// null: the two values have no order (mixed kinds).
export function compareValues(a: Value, b: Value): number | null {
  const x = coerceDate(a);
  const y = coerceDate(b);
  if ((a instanceof DateValue || b instanceof DateValue) && x && y) return x.ms - y.ms;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return null;
}

type Fn = (recv: Value, args: Value[], c: FnCtx) => Value;
const strArgs = (args: Value[]): string[] => args.filter((a): a is string => typeof a === "string");
const normTag = (t: string): string => t.replace(/^#/, "").toLowerCase();

function isEmptyValue(v: Value): boolean {
  switch (kindOf(v)) {
    case "null":
      return true;
    case "string":
      return v === "";
    case "list":
      return (v as Value[]).length === 0;
    case "object":
      return Object.keys(v as object).length === 0;
    default:
      return false;
  }
}

const anyMethods = new Map<string, Fn>([
  ["isTruthy", (r) => truthy(r)],
  ["toString", (r) => toStr(r)],
  ["isEmpty", (r) => isEmptyValue(r)],
]);

const stringMethods = new Map<string, Fn>([
  ["contains", (r, a) => typeof a[0] === "string" && (r as string).includes(a[0])],
  ["containsAll", (r, a) => strArgs(a).length === a.length && a.every((x) => (r as string).includes(x as string))],
  ["containsAny", (r, a) => strArgs(a).some((x) => (r as string).includes(x))],
  ["startsWith", (r, a) => typeof a[0] === "string" && (r as string).startsWith(a[0])],
  ["endsWith", (r, a) => typeof a[0] === "string" && (r as string).endsWith(a[0])],
  ["lower", (r) => (r as string).toLowerCase()],
  ["upper", (r) => (r as string).toUpperCase()],
  ["trim", (r) => (r as string).trim()],
]);

const listMethods = new Map<string, Fn>([
  ["contains", (r, a) => (r as Value[]).some((x) => looseEq(x, a[0] ?? null))],
  ["containsAll", (r, a) => a.every((v) => (r as Value[]).some((x) => looseEq(x, v)))],
  ["containsAny", (r, a) => a.some((v) => (r as Value[]).some((x) => looseEq(x, v)))],
]);

const dateMethods = new Map<string, Fn>([
  ["format", (r, a) => formatDate(r as DateValue, typeof a[0] === "string" ? a[0] : "YYYY-MM-DD")],
]);

const fileMethods = new Map<string, Fn>([
  [
    "hasTag",
    (r, a) => {
      const tags = (r as FileObject).data.tags.map(normTag);
      return strArgs(a)
        .map(normTag)
        .some((w) => tags.some((t) => t === w || t.startsWith(`${w}/`)));
    },
  ],
  [
    "inFolder",
    (r, a) => {
      const f = typeof a[0] === "string" ? a[0].replace(/^\/+|\/+$/g, "") : null;
      if (f === null) return false;
      const folder = (r as FileObject).folder;
      return f === "" || folder === f || folder.startsWith(`${f}/`);
    },
  ],
  [
    "hasLink",
    (r, a) => {
      const file = r as FileObject;
      const arg = a[0] ?? null;
      let target = linkKey(arg);
      let text: string | null = null;
      if (target === null && typeof arg === "string") {
        text = arg.replace(/^\[\[|\]\]$/g, "").split("|")[0]!.trim();
        target = file.host.resolveLink(file.data.path, text) ?? null;
      }
      if (target === null && text === null) return false;
      return file.host
        .outLinks(file.data.path)
        .some((l) => (l.path !== null && l.path === target) || (text !== null && l.text.toLowerCase() === text.toLowerCase()));
    },
  ],
  ["hasProperty", (r, a) => typeof a[0] === "string" && Object.hasOwn((r as FileObject).data.props, a[0])],
]);

const methodTables = new Map<Kind, Map<string, Fn>>([
  ["string", stringMethods],
  ["list", listMethods],
  ["date", dateMethods],
  ["file", fileMethods],
]);

export function callMethod(recv: Value, name: string, args: Value[], c: FnCtx): Value | typeof UNSUPPORTED {
  const kind = kindOf(recv);
  const fn = methodTables.get(kind)?.get(name) ?? anyMethods.get(name);
  if (fn) return fn(recv, args, c);
  // A missing property is common and not a mistake: stay quiet on null.
  return kind === "null" ? null : UNSUPPORTED;
}

const globalFns = new Map<string, (args: Value[], c: FnCtx) => Value>([
  ["now", (_a, c) => new DateValue(c.now.getTime(), true)],
  ["today", (_a, c) => new DateValue(new Date(c.now.getFullYear(), c.now.getMonth(), c.now.getDate()).getTime(), false)],
  ["date", (a) => coerceDate(a[0] ?? null)],
  ["link", (a) => (a[0] === null || a[0] === undefined ? null : new LinkValue(toStr(a[0]), typeof a[1] === "string" ? a[1] : undefined))],
]);

export function callGlobal(name: string, args: Value[], c: FnCtx): Value | typeof UNSUPPORTED {
  const fn = globalFns.get(name);
  return fn ? fn(args, c) : UNSUPPORTED;
}
```

`server/src/bases/eval.ts`:

```ts
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { Node } from "./expr";
import {
  DateValue,
  FileObject,
  FormulaRoot,
  LinkValue,
  UNSUPPORTED,
  addDuration,
  callGlobal,
  callMethod,
  compareValues,
  kindOf,
  looseEq,
  truthy,
  type FnCtx,
  type Value,
} from "./functions";

export interface Budget {
  steps: number;
  max: number;
  hit: boolean;
}

export interface Scope extends FnCtx {
  file: FileObject;
  props: Record<string, PropValue>;
  // `this.x` reads the note holding the view: its properties plus `file`.
  thisValue: Value;
  formula(name: string): Value;
  budget: Budget;
}

class BudgetExceeded extends Error {}

export const DEFAULT_BUDGET = 10_000;

const isPlainObject = (v: Value): v is { [k: string]: Value } => kindOf(v) === "object";

function getMember(obj: Value, name: string, s: Scope): Value {
  if (obj instanceof FileObject) return obj.get(name);
  if (obj instanceof FormulaRoot) return s.formula(name);
  if (isPlainObject(obj)) return Object.hasOwn(obj, name) ? (obj[name] ?? null) : null;
  if (name === "length" && (typeof obj === "string" || Array.isArray(obj))) return obj.length;
  return null;
}

function arith(op: string, a: Value, b: Value, s: Scope): Value {
  const da = a instanceof DateValue ? a : null;
  if (da && (op === "+" || op === "-") && typeof b === "string") {
    const r = addDuration(da, b, op === "+" ? 1 : -1);
    if (!r) s.warn(`invalid duration "${b}"`);
    return r;
  }
  if (da && op === "-") {
    const other = b instanceof DateValue ? b : null;
    return other ? da.ms - other.ms : null;
  }
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return b === 0 ? null : a / b;
      case "%":
        return b === 0 ? null : a % b;
    }
  }
  if (op === "+" && (typeof a === "string" || typeof b === "string") && a !== null && b !== null) {
    return `${typeof a === "string" ? a : String(a)}${typeof b === "string" ? b : String(b)}`;
  }
  return null;
}

function ev(n: Node, s: Scope): Value {
  if (s.budget.hit) return null;
  if (++s.budget.steps > s.budget.max) {
    s.budget.hit = true;
    throw new BudgetExceeded();
  }
  switch (n.t) {
    case "lit":
      return n.v;
    case "id":
      switch (n.name) {
        case "file":
          return s.file;
        case "note":
          return s.props as Value;
        case "formula":
          return new FormulaRoot();
        case "this":
          return s.thisValue;
        default:
          return Object.hasOwn(s.props, n.name) ? (s.props[n.name] as Value) : null;
      }
    case "member":
      return getMember(ev(n.obj, s), n.name, s);
    case "index": {
      const obj = ev(n.obj, s);
      const key = ev(n.key, s);
      if (typeof key === "string") return getMember(obj, key, s);
      if (typeof key === "number" && Array.isArray(obj)) return obj[key] ?? null;
      return null;
    }
    case "unary": {
      const v = ev(n.arg, s);
      return n.op === "!" ? !truthy(v) : typeof v === "number" ? -v : null;
    }
    case "bin": {
      if (n.op === "&&") return truthy(ev(n.l, s)) && truthy(ev(n.r, s));
      if (n.op === "||") return truthy(ev(n.l, s)) || truthy(ev(n.r, s));
      const a = ev(n.l, s);
      const b = ev(n.r, s);
      switch (n.op) {
        case "==":
          return looseEq(a, b);
        case "!=":
          return !looseEq(a, b);
        case "<":
        case "<=":
        case ">":
        case ">=": {
          const c = compareValues(a, b);
          if (c === null) return false;
          return n.op === "<" ? c < 0 : n.op === "<=" ? c <= 0 : n.op === ">" ? c > 0 : c >= 0;
        }
        default:
          return arith(n.op, a, b, s);
      }
    }
    case "call": {
      const callee = n.callee;
      if (callee.t === "id") {
        if (callee.name === "if") {
          if (n.args.length < 2) {
            s.warn('"if" needs a condition and a value');
            return null;
          }
          if (truthy(ev(n.args[0]!, s))) return ev(n.args[1]!, s);
          return n.args[2] ? ev(n.args[2], s) : null;
        }
        const r = callGlobal(callee.name, n.args.map((a) => ev(a, s)), s);
        if (r === UNSUPPORTED) {
          s.warn(`unsupported function "${callee.name}"`);
          return null;
        }
        return r;
      }
      if (callee.t === "member") {
        const recv = ev(callee.obj, s);
        const r = callMethod(recv, callee.name, n.args.map((a) => ev(a, s)), s);
        if (r === UNSUPPORTED) {
          s.warn(`unsupported function "${callee.name}"`);
          return null;
        }
        return r;
      }
      s.warn("unsupported call");
      return null;
    }
  }
}

export function evaluate(n: Node, s: Scope): Value {
  try {
    return ev(n, s);
  } catch (e) {
    if (e instanceof BudgetExceeded) {
      s.warn("evaluation budget exceeded for a note; its remaining expressions were skipped");
      return null;
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd server && bun test test/bases.eval.test.ts test/bases.expr.test.ts && cd .. && bun run typecheck`
Expected: PASS (18 + 7 tests), typecheck clean. The tests assume the local time zone for date arithmetic only through `new Date(y, m, d)` fixtures, so they pass in any zone.

- [ ] **Step 5: Commit**

```bash
git add server/src/bases/functions.ts server/src/bases/eval.ts server/test/bases.eval.test.ts
git commit -m "feat(bases): expression evaluator, functions and step budget" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---


### Task 5: The index keeps each note's revision

**Files:**
- Modify: `server/src/index/index.ts`
- Test: `server/test/index.revision.test.ts`

**Interfaces:**
- Consumes: `vault.readNote(path)` returns `revision` (sha256 of the content); Phase 1's `IndexEntry` (`props`, `ctime`) and `IndexData.version: 3`.
- Produces: `IndexEntry.revision: string` (the same value `GET /api/note/*` reports and `PATCH /api/note-properties/*` takes as `baseRevision`), `IndexData.version: 4`. Entries are rebuilt on every write event, so the revision follows the file; an old snapshot (version 3) is discarded and rebuilt at startup.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Vault } from "../src/vault/vault";
import { VaultIndex } from "../src/index/index";

let dir!: string;
let vault!: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-idx-rev-"));
  vault = new Vault(dir);
  await vault.ensureRoot();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("IndexEntry.revision", () => {
  test("is the revision readNote reports and follows a rewrite", async () => {
    await vault.writeNote("a.md", "one");
    const idx = new VaultIndex(vault);
    await idx.buildAll();
    const first = idx.get("a.md")?.revision;
    expect(first).toBe((await vault.readNote("a.md")).revision);

    await vault.writeNote("a.md", "two");
    await idx.updatePath("a.md");
    expect(idx.get("a.md")?.revision).toBe((await vault.readNote("a.md")).revision);
    expect(idx.get("a.md")?.revision).not.toBe(first);
  });

  test("a version 3 snapshot is discarded and rebuilt, so entries gain a revision", async () => {
    await vault.writeNote("a.md", "one");
    const abs = vault.abs(".brain/index.json");
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify({ version: 3, entries: { "a.md": { path: "a.md" } } }));
    const idx = new VaultIndex(vault);
    await idx.loadOrBuild();
    expect(idx.get("a.md")?.revision).toBe((await vault.readNote("a.md")).revision);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test test/index.revision.test.ts`
Expected: FAIL, `expect(received).toBe(expected)` with `undefined` for the first test (no `revision` yet) and the same for the snapshot test (version 3 is still accepted).

- [ ] **Step 3: Make the changes in `server/src/index/index.ts`**

Find each spot with `grep -n "version\|ctime" server/src/index/index.ts`. Four `version` sites and two entry sites change.

In `interface IndexEntry`, after the `ctime` field Phase 1 added:

```ts
  // sha256 of the file content: what PUT /api/note and PATCH
  // /api/note-properties take as baseRevision. Kept here so a view can edit a
  // row without reading its file.
  revision: string;
```

In `interface IndexData`, replace the comment and the version:

```ts
  // 2 added the hidden/noSearch flags, 3 added props and ctime, 4 added
  // revision; an older snapshot is rebuilt.
  version: 4;
```

In the class field initialiser, in `buildAll()` and in `load()`, change the literal `3` to `4`:

```ts
  private data: IndexData = { version: 4, entries: {} };
```

```ts
    this.data = { version: 4, entries: next };
```

```ts
      if (parsed.version === 4) {
```

In `buildEntry`, in the returned object right after the `ctime:` line:

```ts
        revision: data.revision,
```

- [ ] **Step 4: Run the new test, the index tests and the typecheck**

Run: `cd server && bun test test/index.revision.test.ts test/index.test.ts && cd .. && bun run typecheck`
Expected: PASS. If a Phase 1 test builds an `IndexEntry` literal by hand, the typecheck names it: add `revision: ""` there.

- [ ] **Step 5: Commit**

```bash
git add server/src/index/index.ts server/test/index.revision.test.ts
git commit -m "feat(index): keep each note's revision, snapshot version 4" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 6: The query engine

**Files:**
- Create: `server/src/bases/query.ts`
- Test: `server/test/bases.query.test.ts`

**Interfaces:**
- Consumes: `parseBase` (Task 1), `parseExpression` (Task 3), `evaluate`, `Scope`, `Budget`, `DEFAULT_BUDGET` (Task 4), `FileObject`, `FileHost`, `compareValues`, `toProp`, `toStr`, `truthy`, `Value` (Task 4), `BaseQueryRequest`, `BaseQueryResponse` (Task 1).
- Produces (exact): `interface QueryEntry { path; title; size; mtime; ctime; tags; props; revision; outLinks: Array<{ target; embed }> }`, `interface QueryIndex { entries(); backlinks(path, allowed?); resolveLink(from, target); visibility? }` (the slice of `VaultIndex` a query reads, so tests pass a plain object), `interface QueryDeps { index: QueryIndex; allowed(path): boolean; types: ReadonlyMap<string, PropertyType>; now?: Date }`, `runBaseQuery(req: BaseQueryRequest, deps: QueryDeps): BaseQueryResponse`. `types` is the registry-resolved map from Phase 1's `listProperties`.
- Behaviour (each has a test): global filters AND view filters; hidden notes and the note at `thisPath` are left out; `this` is bound to `thisPath` and ignored with a warning when the caller cannot read it; formulas are lazy and memoised per row, a self-reference gives null plus a warning; sort is multi-key and type-aware with empty values last in both directions; `groupBy` with `groupOrder` (listed groups first, even when empty, then the rest ascending or descending, the null group last as "No value"); view `limit` then request `offset` and `limit` (default 500, clamp 1 to 2000); columns from `order` (default `file.name`) with labels (`properties.<key>.displayName` or a default) and types; rows and link-valued cells are filtered by `allowed` (`file.links`, `file.backlinks`, link properties); `values` objects have no prototype, so a column named `__proto__` is harmless.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { runBaseQuery, type QueryEntry, type QueryIndex } from "../src/bases/query";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";

const NOW = new Date(2026, 10, 26, 12, 0);

function entry(path: string, props: Record<string, PropValue>, over: Partial<QueryEntry> = {}): QueryEntry {
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return {
    path,
    title: base,
    size: 100,
    mtime: Date.UTC(2026, 10, 1),
    ctime: Date.UTC(2026, 9, 1),
    tags: [],
    props,
    revision: `rev-${base}`,
    outLinks: [],
    ...over,
  };
}

const ENTRIES: QueryEntry[] = [
  entry("tasks/A.md", { status: "Todo", n: 10, due: "2026-12-05", owner: "[[people/Ann]]" }, { tags: ["work"], size: 50 }),
  entry("tasks/B.md", { status: "Doing", n: 2, due: "2026-11-01" }, { tags: ["work", "urgent"], outLinks: [{ target: "A", embed: false }, { target: "secret/S", embed: false }] }),
  entry("tasks/C.md", { status: "Done", n: 33 }, { size: 300 }),
  entry("tasks/D.md", { n: 5, owner: ["[[people/Ann]]", "[[secret/S]]"] }),
  entry("secret/S.md", { status: "Todo", n: 1 }),
  entry("hidden/H.md", { status: "Todo", n: 99 }),
  entry("people/Ann.md", { role: "dev" }),
  entry("views/V.md", { x: "view-note", status: "Todo", n: 7 }),
];

function index(over: Partial<QueryIndex> = {}): QueryIndex {
  return {
    entries: () => ENTRIES,
    backlinks: (p, allowed) =>
      ENTRIES.filter((e) => e.outLinks.some((l) => (l.target === "A" ? "tasks/A.md" : l.target === "secret/S" ? "secret/S.md" : "") === p))
        .map((e) => ({ from: e.path }))
        .filter((b) => !allowed || allowed(b.from)),
    resolveLink: (_f, t) => ENTRIES.find((e) => e.path.replace(/\.md$/, "") === t || e.path.endsWith(`/${t}.md`))?.path,
    visibility: { isHidden: (p) => p.startsWith("hidden/") },
    ...over,
  };
}

const TYPES = new Map<string, PropertyType>([
  ["status", "text"],
  ["n", "number"],
  ["due", "date"],
  ["owner", "multitext"],
]);

const ALL = () => true;
const NO_SECRET = (p: string) => !p.startsWith("secret/");

function q(source: string, o: { allowed?: (p: string) => boolean; req?: object; idx?: QueryIndex } = {}) {
  return runBaseQuery({ source, ...o.req }, { index: o.idx ?? index(), allowed: o.allowed ?? ALL, types: TYPES, now: NOW });
}

const paths = (r: ReturnType<typeof q>) => r.groups.flatMap((g) => g.rows.map((x) => x.path));

describe("shape", () => {
  test("default view, default column, hidden and own note left out", () => {
    const r = q("", { req: { thisPath: "views/V.md" } });
    expect(r.views).toEqual([{ name: "Table", type: "table" }]);
    expect(r.view).toBe("Table");
    expect(r.columns).toEqual([{ key: "file.name", label: "Name", type: "file" }]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ key: null, label: "" });
    expect(paths(r)).not.toContain("hidden/H.md");
    expect(paths(r)).not.toContain("views/V.md");
    expect(r.total).toBe(6);
    expect(r.groups[0]!.rows[0]).toEqual({ path: expect.any(String), title: expect.any(String), revision: expect.stringMatching(/^rev-/), values: expect.any(Object) });
  });

  test("columns: labels, types, displayName, formulas", () => {
    const r = q(`properties:\n  status:\n    displayName: State\nformulas:\n  big: n > 9\nviews:\n  - type: table\n    name: T\n    order: [file.name, status, n, due, formula.big, note.owner, file.size]\n`);
    expect(r.columns).toEqual([
      { key: "file.name", label: "Name", type: "file" },
      { key: "status", label: "State", type: "text" },
      { key: "n", label: "n", type: "number" },
      { key: "due", label: "due", type: "date" },
      { key: "formula.big", label: "big", type: "formula" },
      { key: "note.owner", label: "owner", type: "multitext" },
      { key: "file.size", label: "Size", type: "file" },
    ]);
  });

  test("bad YAML: empty response with a warning, no throw", () => {
    const r = q("views: [");
    expect(r.groups).toEqual([]);
    expect(r.warnings[0]).toStartWith("YAML:");
  });

  test("unknown view falls back to the first with a warning; names match case-insensitively", () => {
    const src = "views:\n  - type: table\n    name: One\n  - type: list\n    name: Two\n";
    expect(q(src, { req: { view: "two" } }).view).toBe("Two");
    const r = q(src, { req: { view: "Nope" } });
    expect(r.view).toBe("One");
    expect(r.warnings).toEqual(['view "Nope" was not found; showing "One"']);
  });
});

describe("filters", () => {
  test("global and view filters combine with AND; and / or / not", () => {
    const r = q(`filters: file.inFolder("tasks")
views:
  - type: table
    name: T
    filters:
      or:
        - status == "Todo"
        - and:
            - n < 6
            - not:
                - file.hasTag("urgent")
`);
    expect(paths(r).sort()).toEqual(["tasks/A.md", "tasks/D.md"]);
  });

  test("a filter that cannot be parsed is ignored with a warning; the view is not blanked", () => {
    const r = q('views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - "n ? 1"\n        - status == "Done"\n');
    expect(paths(r)).toEqual(["tasks/C.md"]);
    expect(r.warnings[0]).toStartWith("filter ignored");
    expect(q('filters: "n ? 1"\n').total).toBe(7);
  });

  test("an unsupported function inside a filter is null, so the row is out, plus one warning", () => {
    const r = q('filters: sum(n) > 1\n');
    expect(r.total).toBe(0);
    expect(r.warnings).toEqual(['unsupported function "sum"']);
  });

  test("this binds to thisPath", () => {
    const r = q('filters: status == this.status\n', { req: { thisPath: "views/V.md" } });
    expect(paths(r).sort()).toEqual(["secret/S.md", "tasks/A.md"]);
  });

  test("this is ignored, with a warning, when the caller cannot read thisPath", () => {
    const r = q('filters: this.status == "Todo"\n', { allowed: NO_SECRET, req: { thisPath: "secret/S.md" } });
    expect(r.total).toBe(0);
    expect(r.warnings).toContain("the note holding this view is not readable; `this` was left empty");
  });

  test("file.* in filters", () => {
    expect(paths(q("filters: file.size < 100\n"))).toEqual(["tasks/A.md"]);
    expect(paths(q('filters: file.hasLink("A")\n'))).toEqual(["tasks/B.md"]);
    expect(paths(q("filters: file.backlinks.length > 0\n")).sort()).toEqual(["secret/S.md", "tasks/A.md"]);
  });
});

describe("formulas", () => {
  test("evaluate per row, may use other formulas, cycles give null", () => {
    const r = q(`formulas:
  double: n * 2
  plus: formula.double + 1
  loop: formula.loop
  late: due < today()
views:
  - type: table
    name: T
    filters: file.inFolder("tasks")
    order: [file.name, formula.double, formula.plus, formula.loop, formula.late]
    sort:
      - property: file.name
        direction: ASC
`);
    const byName = Object.fromEntries(r.groups[0]!.rows.map((x) => [x.title, x.values]));
    expect(byName.A).toMatchObject({ "formula.double": 20, "formula.plus": 21, "formula.loop": null, "formula.late": false });
    expect(byName.B).toMatchObject({ "formula.late": true });
    expect(r.warnings).toContain('formula "loop" refers to itself');
  });
});

describe("sort", () => {
  test("numbers sort numerically, empty values last in both directions", () => {
    const asc = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: status\n        direction: ASC\n      - property: n\n        direction: DESC\n    order: [status, n]\n');
    expect(paths(asc)).toEqual(["tasks/B.md", "tasks/C.md", "tasks/A.md", "tasks/D.md"]);
    const num = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: n\n        direction: ASC\n');
    expect(paths(num)).toEqual(["tasks/B.md", "tasks/D.md", "tasks/A.md", "tasks/C.md"]);
    const desc = q('views:\n  - type: table\n    name: T\n    sort:\n      - property: status\n        direction: DESC\n');
    expect(paths(desc).slice(-2).sort()).toEqual(["people/Ann.md", "tasks/D.md"]);
  });

  test("dates and file properties", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: due\n        direction: ASC\n');
    expect(paths(r).slice(0, 2)).toEqual(["tasks/B.md", "tasks/A.md"]);
    const bySize = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: file.size\n        direction: DESC\n');
    expect(paths(bySize)[0]).toBe("tasks/C.md");
  });
});

describe("groupBy", () => {
  const src = (extra = "") =>
    `filters: file.inFolder("tasks")\nviews:\n  - type: kanban\n    name: B\n    groupBy:\n      property: status\n      direction: ASC\n${extra}    order: [file.name]\n`;

  test("groups in order, empty value last as No value", () => {
    const r = q(src());
    expect(r.groups.map((g) => [g.key, g.label, g.count])).toEqual([
      ["Doing", "Doing", 1],
      ["Done", "Done", 1],
      ["Todo", "Todo", 1],
      [null, "No value", 1],
    ]);
  });

  test("groupOrder wins, includes empty groups, the rest follows", () => {
    const r = q(src("    groupOrder: [Todo, Blocked, Doing]\n"));
    expect(r.groups.map((g) => [g.key, g.count])).toEqual([["Todo", 1], ["Blocked", 0], ["Doing", 1], ["Done", 1], [null, 1]]);
  });

  test("DESC reverses the unlisted groups but keeps No value last", () => {
    const r = q(src().replace("ASC", "DESC"));
    expect(r.groups.map((g) => g.key)).toEqual(["Todo", "Done", "Doing", null]);
  });

  test("a link property cannot leak its target through a group key", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: owner\n', { allowed: NO_SECRET });
    expect(r.groups.map((g) => [g.key, g.count])).toEqual([["[[people/Ann]]", 2], [null, 2]]);
    expect(JSON.stringify(r)).not.toContain("secret");
  });

  test("numbers group numerically ordered", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: n\n      direction: ASC\n');
    expect(r.groups.map((g) => g.key)).toEqual(["2", "5", "10", "33"]);
  });
});

describe("step budget", () => {
  test("the budget is per note: a long filter over 8000 notes keeps every row", () => {
    const many = Array.from({ length: 8000 }, (_, i) => entry(`bulk/n${i}.md`, { status: "Todo", n: i }));
    const filter = 'status == "Todo" && n >= 0 && (n < 100000 || n > 200000) && !(status == "Done") && file.inFolder("bulk")';
    const r = q(`filters: '${filter}'\nviews:\n  - type: table\n    name: T\n`, {
      idx: index({ entries: () => many }),
      req: { limit: 2000 },
    });
    expect(r.total).toBe(8000);
    expect(r.warnings).toEqual([]);
  });
});

describe("limit and paging", () => {
  const src = 'filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    limit: 3\n    sort:\n      - property: file.name\n        direction: ASC\n';
  test("view limit caps total; offset and limit page the rest", () => {
    expect(q(src).total).toBe(3);
    const p = q(src, { req: { offset: 1, limit: 1 } });
    expect(paths(p)).toEqual(["tasks/B.md"]);
    expect(p.total).toBe(3);
  });

  test("request limit is clamped to 1..2000 and defaults to 500", () => {
    const big = Array.from({ length: 2100 }, (_, i) => entry(`bulk/n${i}.md`, {}));
    const idx = index({ entries: () => big });
    expect(paths(q("", { idx, req: { limit: 99999 } }))).toHaveLength(2000);
    expect(paths(q("", { idx }))).toHaveLength(500);
    expect(q("", { idx, req: { limit: 0 } }).groups[0]!.rows).toHaveLength(1);
  });

  test("grouped paging keeps whole-group counts", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    groupBy:\n      property: status\n', { req: { offset: 1, limit: 1 } });
    expect(r.total).toBe(4);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ key: "Done", count: 1 });
  });
});

describe("file values", () => {
  test("every documented file.* column", () => {
    const r = q('filters: file.hasLink("A")\nviews:\n  - type: table\n    name: T\n    order: [file.name, file.basename, file.fullname, file.path, file.folder, file.ext, file.size, file.tags, file.links, file.embeds, file.backlinks, file.ctime, file.mtime, file.properties]\n');
    const v = r.groups[0]!.rows[0]!.values;
    expect(v["file.name"]).toBe("B.md");
    expect(v["file.basename"]).toBe("B");
    expect(v["file.fullname"]).toBe("B.md");
    expect(v["file.folder"]).toBe("tasks");
    expect(v["file.ext"]).toBe("md");
    expect(v["file.size"]).toBe(100);
    expect(v["file.tags"]).toEqual(["work", "urgent"]);
    expect(v["file.links"]).toEqual(["[[tasks/A]]", "[[secret/S]]"]);
    expect(v["file.embeds"]).toEqual([]);
    expect(v["file.ctime"]).toBe("2026-10-01T00:00:00.000Z");
    expect(v["file.properties"]).toEqual({ status: "Doing", n: 2, due: "2026-11-01" });
  });

  test("backlinks come from the index", () => {
    const r = q('filters: file.name == "A.md"\nviews:\n  - type: table\n    name: T\n    order: [file.backlinks]\n');
    expect(r.groups[0]!.rows[0]!.values["file.backlinks"]).toEqual(["[[tasks/B]]"]);
  });
});

describe("cards cover property", () => {
  test("is in values but not in columns", () => {
    const r = q('filters: file.name == "A.md"\nviews:\n  - type: cards\n    name: C\n    image: owner\n    order: [file.name]\n');
    expect(r.columns.map((c) => c.key)).toEqual(["file.name"]);
    expect(r.groups[0]!.rows[0]!.values.owner).toBe("[[people/Ann]]");
  });
});

describe("permissions", () => {
  test("rows the caller cannot read never appear, and do not count", () => {
    const r = q('filters: status == "Todo"\n', { allowed: NO_SECRET });
    expect(paths(r).sort()).toEqual(["tasks/A.md", "views/V.md"]);
    expect(r.total).toBe(2);
  });

  test("link-valued cells drop unreadable targets: file.links, backlinks, link properties", () => {
    const r = q('filters: file.inFolder("tasks")\nviews:\n  - type: table\n    name: T\n    order: [file.name, file.links, owner]\n    sort:\n      - property: file.name\n        direction: ASC\n', { allowed: NO_SECRET });
    const rows = Object.fromEntries(r.groups[0]!.rows.map((x) => [x.title, x.values]));
    expect(rows.B!["file.links"]).toEqual(["[[tasks/A]]"]);
    expect(rows.A!.owner).toBe("[[people/Ann]]");
    expect(rows.D!.owner).toEqual(["[[people/Ann]]"]);
    expect(JSON.stringify(r)).not.toContain("secret");
    const bl = q('filters: file.name == "A.md"\nviews:\n  - type: table\n    name: T\n    order: [file.backlinks]\n', { allowed: (p) => p !== "tasks/B.md" });
    expect(bl.groups[0]!.rows[0]!.values["file.backlinks"]).toEqual([]);
  });

  test("filters over backlinks cannot count unreadable sources", () => {
    const r = q("filters: file.backlinks.length > 0\n", { allowed: NO_SECRET });
    expect(paths(r)).toEqual(["tasks/A.md"]);
    const none = q("filters: file.backlinks.length > 0\n", { allowed: (p) => !p.startsWith("secret/") && p !== "tasks/B.md" });
    expect(paths(none)).toEqual([]);
  });

  test("a caller with no read access gets no rows", () => {
    expect(q("", { allowed: () => false }).total).toBe(0);
  });

  test("a values object with a __proto__ column does not pollute", () => {
    const r = q('views:\n  - type: table\n    name: T\n    order: ["__proto__", file.name]\n');
    expect(Object.getPrototypeOf(r.groups[0]!.rows[0]!.values)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test test/bases.query.test.ts`
Expected: FAIL, "Cannot find module '../src/bases/query'".

- [ ] **Step 3: Write the implementation**

```ts
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LIMIT,
  type BaseQueryRequest,
  type BaseQueryResponse,
  type FilterNode,
} from "@brainmd/shared/base-types";
import { parseExpression, type Node } from "./expr";
import { DEFAULT_BUDGET, evaluate, type Scope } from "./eval";
import {
  FileObject,
  compareValues,
  kindOf,
  toProp,
  toStr,
  truthy,
  type FileData,
  type FileHost,
  type Value,
} from "./functions";
import { parseBase, type ViewConfig } from "./parse";

export interface QueryEntry {
  path: string;
  title: string;
  size: number;
  mtime: number;
  ctime: number;
  tags: string[];
  props: Record<string, PropValue>;
  revision: string;
  outLinks: Array<{ target: string; embed: boolean }>;
}

// The slice of VaultIndex a query reads, so tests can pass a plain object.
export interface QueryIndex {
  entries(): QueryEntry[];
  backlinks(path: string, allowed?: (path: string) => boolean): Array<{ from: string }>;
  resolveLink(fromPath: string, target: string): string | undefined;
  visibility?: { isHidden(path: string): boolean };
}

export interface QueryDeps {
  index: QueryIndex;
  allowed: (path: string) => boolean;
  // Effective property types (registry first, then inferred), from listProperties.
  types: ReadonlyMap<string, PropertyType>;
  now?: Date;
}

type Compiled = { leaf: Node | null } | { op: "and" | "or" | "not"; kids: Compiled[] };

const DEFAULT_VIEW: ViewConfig = {
  type: "table",
  name: "Table",
  order: [],
  sort: [],
  groupOrder: [],
  columnSize: {},
  summaries: {},
};

const WIKI = /^\[\[([^\]|#^]*)/;
const DROP = Symbol("drop");
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

export function runBaseQuery(req: BaseQueryRequest, deps: QueryDeps): BaseQueryResponse {
  const { index, allowed, types } = deps;
  const now = deps.now ?? new Date();
  const warnings = new Set<string>();
  const warn = (m: string): void => void warnings.add(m);
  const done = (r: Omit<BaseQueryResponse, "warnings">): BaseQueryResponse => ({ ...r, warnings: [...warnings] });
  const nothing = { views: [], view: "", columns: [], groups: [], total: 0 };

  const parsed = parseBase(req.source);
  for (const w of parsed.warnings) warn(w);
  if (parsed.fatal) return done(nothing);
  const cfg = parsed.config;
  const views = cfg.views.length > 0 ? cfg.views : [DEFAULT_VIEW];
  const wanted = req.view?.toLowerCase();
  const view = (req.view ? views.find((v) => v.name === req.view) : undefined) ?? views.find((v) => v.name.toLowerCase() === wanted) ?? views[0]!;
  if (req.view && view.name.toLowerCase() !== wanted) warn(`view "${req.view}" was not found; showing "${view.name}"`);

  const entries = index.entries();
  const byPath = new Map(entries.map((e) => [e.path, e]));
  const host: FileHost = {
    resolveLink: (from, target) => index.resolveLink(from, target),
    outLinks: (path) =>
      (byPath.get(path)?.outLinks ?? [])
        .map((l) => ({ text: l.target, embed: l.embed, path: index.resolveLink(path, l.target) ?? null }))
        .filter((l) => l.path === null || allowed(l.path)),
    backlinks: (path) => [...new Set(index.backlinks(path, allowed).map((b) => b.from))],
  };
  const files = new Map<string, FileObject>();
  const fileOf = (e: QueryEntry): FileObject => {
    let f = files.get(e.path);
    if (!f) {
      const data: FileData = { path: e.path, size: e.size, ctime: e.ctime, mtime: e.mtime, tags: e.tags, props: e.props };
      f = new FileObject(data, host);
      files.set(e.path, f);
    }
    return f;
  };

  let thisPath = req.thisPath;
  if (thisPath && (!allowed(thisPath) || !byPath.has(thisPath))) {
    warn("the note holding this view is not readable; `this` was left empty");
    thisPath = undefined;
  }
  const thisEntry = thisPath ? byPath.get(thisPath) : undefined;
  let thisValue: Value = null;
  if (thisEntry) {
    const t: Record<string, Value> = Object.create(null);
    Object.assign(t, thisEntry.props);
    t.file = fileOf(thisEntry);
    thisValue = t;
  }

  const formulaNodes = new Map<string, Node | null>();
  const formulaNode = (name: string): Node | null => {
    if (formulaNodes.has(name)) return formulaNodes.get(name)!;
    const p = parseExpression(cfg.formulas[name]!);
    if (!p.ok) warn(`formula "${name}": ${p.error}`);
    const node = p.ok ? p.node : null;
    formulaNodes.set(name, node);
    return node;
  };

  const scopeFor = (e: QueryEntry): Scope => {
    const memo = new Map<string, Value>();
    const busy = new Set<string>();
    const scope: Scope = {
      now,
      warn,
      file: fileOf(e),
      props: e.props,
      thisValue,
      // Per note, so a big vault cannot run one shared budget dry and drop the tail rows.
      budget: { steps: 0, max: DEFAULT_BUDGET, hit: false },
      formula: (name) => {
        if (!Object.hasOwn(cfg.formulas, name)) {
          warn(`unknown formula "${name}"`);
          return null;
        }
        if (memo.has(name)) return memo.get(name)!;
        if (busy.has(name)) {
          warn(`formula "${name}" refers to itself`);
          return null;
        }
        busy.add(name);
        const node = formulaNode(name);
        const v = node ? evaluate(node, scope) : null;
        busy.delete(name);
        memo.set(name, v);
        return v;
      },
    };
    return scope;
  };

  const compile = (f: FilterNode | undefined): Compiled | null => {
    if (f === undefined) return null;
    if (typeof f === "string") {
      const p = parseExpression(f);
      if (!p.ok) warn(`filter ignored (${p.error}): ${f}`);
      return { leaf: p.ok ? p.node : null };
    }
    const op = "and" in f ? "and" : "or" in f ? "or" : "not";
    const list = (f as Record<string, FilterNode[]>)[op]!;
    return { op, kids: list.map((k) => compile(k)).filter((k): k is Compiled => k !== null) };
  };

  // undefined: the filter could not be read, so it neither passes nor fails a row.
  const test = (c: Compiled, scope: Scope): boolean | undefined => {
    if ("leaf" in c) return c.leaf ? truthy(evaluate(c.leaf, scope)) : undefined;
    const res = c.kids.map((k) => test(k, scope)).filter((r): r is boolean => r !== undefined);
    if (res.length === 0) return undefined;
    if (c.op === "and") return res.every(Boolean);
    if (c.op === "or") return res.some(Boolean);
    return !res.some(Boolean);
  };

  const globalFilter = compile(cfg.filters);
  const viewFilter = compile(view.filters);
  const rows: Array<{ e: QueryEntry; scope: Scope }> = [];
  for (const e of entries) {
    if (!allowed(e.path) || e.path === thisPath || index.visibility?.isHidden(e.path)) continue;
    const scope = scopeFor(e);
    if (globalFilter && test(globalFilter, scope) === false) continue;
    if (viewFilter && test(viewFilter, scope) === false) continue;
    rows.push({ e, scope });
  }

  const keyValue = (key: string, scope: Scope): Value => {
    if (key.startsWith("file.")) return scope.file.get(key.slice(5));
    if (key.startsWith("formula.")) return scope.formula(key.slice(8));
    const name = key.startsWith("note.") ? key.slice(5) : key;
    return Object.hasOwn(scope.props, name) ? (scope.props[name] as Value) : null;
  };

  const isEmpty = (v: Value): boolean => v === null || v === "" || (Array.isArray(v) && v.length === 0);
  const order = (a: Value, b: Value): number => compareValues(a, b) ?? toStr(a).localeCompare(toStr(b), undefined, { numeric: true });

  const sortVals = new Map(rows.map((r) => [r, view.sort.map((s) => keyValue(s.property, r.scope))]));
  rows.sort((x, y) => {
    for (let i = 0; i < view.sort.length; i++) {
      const a = sortVals.get(x)![i]!;
      const b = sortVals.get(y)![i]!;
      const ea = isEmpty(a);
      const eb = isEmpty(b);
      if (ea || eb) {
        if (ea && eb) continue;
        return ea ? 1 : -1;
      }
      const c = order(a, b);
      if (c !== 0) return view.sort[i]!.direction === "DESC" ? -c : c;
    }
    return x.e.path.localeCompare(y.e.path);
  });

  const clean = (v: PropValue, from: string, depth = 0): PropValue | typeof DROP => {
    if (typeof v === "string") {
      const m = WIKI.exec(v);
      const target = m?.[1]?.trim();
      if (target) {
        const to = index.resolveLink(from, target);
        if (to && !allowed(to)) return DROP;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => clean(x, from, depth + 1)).filter((x): x is PropValue => x !== DROP);
    if (v && typeof v === "object" && depth < 4) {
      const out: Record<string, PropValue> = Object.create(null);
      for (const [k, x] of Object.entries(v)) {
        const c = clean(x, from, depth + 1);
        out[k] = c === DROP ? null : c;
      }
      return out;
    }
    return v;
  };

  const groupKeyOf = (v: Value, from: string): string | null => {
    if (isEmpty(v)) return null;
    const c = clean(toProp(v), from);
    if (c === DROP) return null;
    if (Array.isArray(c)) return c.length === 0 ? null : c.map(String).join(", ");
    return String(c);
  };

  const gb = view.groupBy;
  type Item = { e: QueryEntry; scope: Scope; group: string | null };
  const groupOf = new Map<Item, Value>();
  let items: Item[] = rows.map((r) => {
    const raw = gb ? keyValue(gb.property, r.scope) : null;
    const it = { ...r, group: gb ? groupKeyOf(raw, r.e.path) : null };
    groupOf.set(it, raw);
    return it;
  });

  let groupKeys: Array<string | null> = [null];
  if (gb) {
    const present = new Map<string | null, Value>();
    for (const it of items) if (!present.has(it.group)) present.set(it.group, groupOf.get(it)!);
    const listed = view.groupOrder.filter((k, i, a) => a.indexOf(k) === i);
    const rest = [...present.keys()].filter((k): k is string => k !== null && !listed.includes(k));
    rest.sort((a, b) => order(present.get(a)!, present.get(b)!));
    if (gb.direction === "DESC") rest.reverse();
    groupKeys = [...listed, ...rest, null];
    const rank = new Map(groupKeys.map((k, i) => [k, i]));
    items = items.sort((a, b) => rank.get(a.group)! - rank.get(b.group)!);
  }
  if (view.limit !== undefined) items = items.slice(0, view.limit);

  const total = items.length;
  const limit = Math.min(Math.max(1, Math.floor(req.limit ?? DEFAULT_QUERY_LIMIT)), MAX_QUERY_LIMIT);
  const offset = Math.max(0, Math.floor(req.offset ?? 0));
  const page = items.slice(offset, offset + limit);

  const colKeys = view.order.length > 0 ? view.order : ["file.name"];
  const display = new Map<string, string>();
  for (const [k, v] of Object.entries(cfg.properties)) if (v.displayName) display.set(k.replace(/^note\./, ""), v.displayName);
  const labelFor = (key: string): string => {
    const dn = display.get(key.replace(/^note\./, ""));
    if (dn) return dn;
    if (key.startsWith("file.")) return cap(key.slice(5));
    if (key.startsWith("formula.")) return key.slice(8);
    return key.replace(/^note\./, "");
  };
  const typeFor = (key: string): PropertyType | "file" | "formula" =>
    key.startsWith("file.") ? "file" : key.startsWith("formula.") ? "formula" : (types.get(key.replace(/^note\./, "")) ?? "text");

  // The cover property of a cards view rides along in `values` without being a column.
  const valueKeys = view.image && !colKeys.includes(view.image) ? [...colKeys, view.image] : colKeys;
  const outRow = (it: Item) => {
    const values: Record<string, PropValue> = Object.create(null);
    for (const k of valueKeys) {
      const c = clean(toProp(keyValue(k, it.scope)), it.e.path);
      values[k] = c === DROP ? null : c;
    }
    return { path: it.e.path, title: it.e.title, revision: it.e.revision, values };
  };

  const groups: BaseQueryResponse["groups"] = [];
  if (!gb) {
    groups.push({ key: null, label: "", count: total, rows: page.map(outRow) });
  } else {
    for (const key of groupKeys) {
      const count = items.filter((i) => i.group === key).length;
      const inPage = page.filter((i) => i.group === key);
      const declared = key !== null && view.groupOrder.includes(key);
      if (inPage.length === 0 && !(declared && count === 0)) continue;
      groups.push({ key, label: key ?? "No value", count, rows: inPage.map(outRow) });
    }
  }

  return done({
    views: views.map((v) => ({ name: v.name, type: v.type })),
    view: view.name,
    columns: colKeys.map((key) => ({ key, label: labelFor(key), type: typeFor(key) })),
    groups,
    total,
  });
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd server && bun test test/bases.query.test.ts && cd .. && bun run typecheck`
Expected: PASS (29 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add server/src/bases/query.ts server/test/bases.query.test.ts
git commit -m "feat(bases): query engine over the index with filters, formulas, sort, groups and permissions" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 7: `POST /api/bases/query`

**Files:**
- Create: `server/src/api/bases.ts`
- Modify: `server/src/app.ts`, `server/test/route-principal-matrix.test.ts`
- Test: `server/test/api.bases.test.ts`

**Interfaces:**
- Consumes: `runBaseQuery` (Task 6), `listProperties(vault, index, allowed?)` (`server/src/properties/registry.ts`, Phase 1 Task 4), `readFilterFor` (`server/src/api/perm-guard.ts`), the `IndexEntry.revision` field (Task 5).
- Produces: `baseRoutes(vault, index)` (Elysia plugin) serving `POST /api/bases/query` with a `BaseQueryRequest` body and a `BaseQueryResponse` reply. Body limits: `source` at most 100000 characters. YAML that does not parse is a 200 with `warnings`, not an error. The route is class `filtered` in the principal matrix: never 403, denied paths just absent.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";

let h!: AppHandle;
let dir!: string;

const TABLE =
  "views:\n  - type: table\n    name: T\n    order: [file.name, status, n, owner]\n    sort:\n      - property: n\n        direction: ASC\n";

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await h.app.handle(new Request(`http://localhost${path}`, init));
  return { status: r.status, json: parseBody(await r.text()) };
}

// JSON.parse returns any, which keeps the assertions below short.
function parseBody(text: string) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

const query = (body: unknown, bearer?: string) => call("POST", "/api/bases/query", body, bearer);
const rowPaths = (r: { json: unknown }) => (r.json as BaseQueryResponse).groups.flatMap((g) => g.rows.map((x) => x.path));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-api-bases-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  await h.vault.writeNote("work/A.md", '---\nstatus: Todo\nn: 2\nowner: "[[secret/S]]"\n---\n# A\n');
  await h.vault.writeNote("work/B.md", "---\nstatus: Doing\nn: 10\n---\n# B\n");
  await h.vault.writeNote("work/C.md", "---\nstatus: Done\nn: 5\nhidden: true\n---\n# C\n");
  await h.vault.writeNote("secret/S.md", "---\nstatus: Todo\nn: 1\n---\n# S\n");
  await h.vault.writeNote("work/View.md", "# View\n");
});

afterEach(async () => {
  h.autocommit.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function lockDown() {
  await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
  await h.authStore.load();
  const login = await call("POST", "/api/auth/login", { password: "hunter2hunter2" });
  const owner = login.json.token as string;
  const key = await call("POST", "/api/auth/keys", { name: "agent" }, owner);
  await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: false }, owner);
  return { owner, apiKey: key.json.token as string };
}

describe("POST /api/bases/query", () => {
  test("rows come sorted, with values, types and the revision a PATCH needs", async () => {
    const r = await query({ source: TABLE, thisPath: "work/View.md" });
    expect(r.status).toBe(200);
    expect(rowPaths(r)).toEqual(["secret/S.md", "work/A.md", "work/B.md"]);
    expect(r.json.columns.map((c: { key: string; type: string }) => [c.key, c.type])).toEqual([
      ["file.name", "file"],
      ["status", "text"],
      ["n", "number"],
      ["owner", "text"],
    ]);
    const a = r.json.groups[0].rows.find((x: { path: string }) => x.path === "work/A.md");
    expect(a.values).toMatchObject({ "file.name": "A.md", status: "Todo", n: 2 });
    expect(a.revision).toBe((await h.vault.readNote("work/A.md")).revision);
  });

  test("offset and limit page the rows; total stays whole", async () => {
    const r = await query({ source: TABLE, thisPath: "work/View.md", offset: 1, limit: 1 });
    expect(rowPaths(r)).toEqual(["work/A.md"]);
    expect(r.json.total).toBe(3);
  });

  test("a hidden note is left out", async () => {
    expect(rowPaths(await query({ source: TABLE }))).not.toContain("work/C.md");
  });

  test("unsupported syntax is a warning, not an error", async () => {
    const r = await query({ source: "filters: sum(n) > 1\n" });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(0);
    expect(r.json.warnings).toEqual(['unsupported function "sum"']);
  });

  test("YAML that does not parse is a 200 with a warning; a body without source is 422", async () => {
    const bad = await query({ source: "views: [" });
    expect(bad.status).toBe(200);
    expect(bad.json.groups).toEqual([]);
    expect(bad.json.warnings[0]).toStartWith("YAML:");
    expect((await call("POST", "/api/bases/query", {})).status).toBe(422);
  });

  test("a folder the caller cannot read: rows, link cells and `this` are all closed", async () => {
    const { apiKey } = await lockDown();
    const r = await query({ source: TABLE, thisPath: "work/View.md" }, apiKey);
    expect(r.status).toBe(200);
    expect(rowPaths(r)).toEqual(["work/A.md", "work/B.md"]);
    expect(JSON.stringify(r.json)).not.toContain("secret/S");
    const a = r.json.groups[0].rows.find((x: { path: string }) => x.path === "work/A.md");
    expect(a.values.owner).toBeNull();

    const sneaky = await query({ source: 'filters: this.status == "Todo"\n', thisPath: "secret/S.md" }, apiKey);
    expect(sneaky.json.total).toBe(0);
    expect(sneaky.json.warnings).toContain("the note holding this view is not readable; `this` was left empty");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && bun test test/api.bases.test.ts`
Expected: FAIL, the first test gets a 404 (no route yet).

- [ ] **Step 3: Write the route**

`server/src/api/bases.ts`:

```ts
import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { runBaseQuery } from "../bases/query";
import { listProperties } from "../properties/registry";
import { readFilterFor } from "./perm-guard";

export function baseRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api/bases" }).post(
    "/query",
    async ({ body, request }) => {
      const allowed = await readFilterFor(vault, request);
      const types = new Map((await listProperties(vault, index, allowed)).map((p) => [p.name, p.type] as const));
      return runBaseQuery(body, { index, allowed, types });
    },
    {
      body: t.Object({
        source: t.String({ maxLength: 100_000 }),
        view: t.Optional(t.String({ maxLength: 200 })),
        thisPath: t.Optional(t.String({ maxLength: 1000 })),
        offset: t.Optional(t.Integer({ minimum: 0 })),
        limit: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  );
}
```

In `server/src/app.ts` add the import next to the other route imports and mount it after `tagRoutes`:

```ts
import { baseRoutes } from "./api/bases";
```

```ts
    .use(tagRoutes(vault, index))
    .use(baseRoutes(vault, index))
```

In `server/test/route-principal-matrix.test.ts`, add a row at the end of the `filtered` group (after the `GET /api/folder-meta` row) and one MCP check is added in Task 8:

```ts
  { name: "POST /api/bases/query", class: "filtered", exec: (f) => call(f.handle, "POST", "/api/bases/query", { source: "views:\n  - type: table\n    name: T\n    order: [file.name]\n" }, f.bearer) },
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd server && bun test test/api.bases.test.ts test/route-principal-matrix.test.ts && cd .. && bun run typecheck`
Expected: PASS. The typecheck is where `VaultIndex` is checked against `QueryIndex`: if it names a missing member, the Phase 1 `IndexEntry` differs from `QueryEntry` in the field it names.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/bases.ts server/src/app.ts server/test/api.bases.test.ts server/test/route-principal-matrix.test.ts
git commit -m "feat(api): POST /api/bases/query" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---


### Task 8: MCP `query_notes` and the 20-tool docs

**Files:**
- Create: `server/src/bases/simple.ts`, `server/test/bases.simple.test.ts`
- Modify: `server/src/mcp/server.ts`, `server/src/mcp/instructions.ts`, `server/test/route-principal-matrix.test.ts`, `README.md`, `docs/mcp.md`, `mcp-prompt.md`
- Test: `server/test/mcp.query-notes.test.ts`

**Interfaces:**
- Consumes: `runBaseQuery` (Task 6), `parseBase` (Task 1), `findBaseFences` (Task 2), `listProperties` (Phase 1), `pageArgs`, `paginate`, `pageContent` (`server/src/mcp/paginate.ts`), `checkRead`, `readFilter`, `toolError`, `logCall`, `READ_ONLY_LOCAL` (already in `server/src/mcp/server.ts`).
- Produces: `simpleBase({ filter?, columns?, sort? }): string` (the YAML of a one-view table, so the simple form runs through the same engine); the MCP tool `query_notes { base?, path?, view?, filter?, columns?, sort?, limit?, offset? }`, read-only, 50 rows per page (max 200). Exactly one of `base`, `path`, or the simple form (`filter` / `columns` / `sort`) may be given. `path` must be a `.md` note; the fence holding a view named `view` is used, else the first fence; `this` is that note. Reply body: `{ view, views, columns, total, warnings, rows: [{ path, title, group?, values }] }`, with the same second text block as the other list tools when more remains.

- [ ] **Step 1: Write the failing tests**

`server/test/bases.simple.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { parseBase } from "../src/bases/parse";
import { simpleBase } from "../src/bases/simple";

describe("simpleBase", () => {
  test("round trips through the parser", () => {
    const src = simpleBase({
      filter: 'status == "Todo" && !file.hasTag("x")',
      columns: ["file.name", "status"],
      sort: [{ property: "n", direction: "DESC" }],
    });
    const v = parseBase(src).config.views[0]!;
    expect(v.filters).toBe('status == "Todo" && !file.hasTag("x")');
    expect(v.order).toEqual(["file.name", "status"]);
    expect(v.sort).toEqual([{ property: "n", direction: "DESC" }]);
  });

  test("an expression YAML would misread is still read back whole", () => {
    for (const f of ["!x", "a: b", "x # y", "- z", "[1]"]) {
      expect(parseBase(simpleBase({ filter: f })).config.views[0]!.filters).toBe(f);
    }
  });

  test("no arguments gives a default table", () => {
    expect(parseBase(simpleBase({})).config.views[0]).toMatchObject({ type: "table", name: "Query", order: [], sort: [] });
  });
});
```

`server/test/mcp.query-notes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { DEFAULT_MCP_INSTRUCTIONS } from "../src/mcp/instructions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let h: AppHandle;
let dir: string;
let client: Client;

const BOARD =
  "# Board\n\n```base\nviews:\n  - type: table\n    name: All\n    order: [file.name, n]\n```\n\n" +
  "```base\nfilters: status == \"Done\"\nviews:\n  - type: kanban\n    name: Finished\n    order: [file.name, status]\n    groupBy:\n      property: status\n```\n";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-query-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  for (let i = 0; i < 60; i++) {
    const n = String(i).padStart(2, "0");
    await h.vault.writeNote(`work/n${n}.md`, `---\nn: ${i}\nstatus: ${i % 2 === 0 ? "Done" : "Todo"}\n---\n# N ${n}\n`);
  }
  await h.vault.writeNote("work/Board.md", BOARD);
  await h.vault.writeNote("work/plain.md", "# Plain\n");
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      h.app.handle(new Request(input, init))) as unknown as typeof fetch,
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
});

afterEach(async () => {
  await client.close();
  h.autocommit.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function call(args: Record<string, unknown>) {
  const r = (await client.callTool({ name: "query_notes", arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: r.isError === true, body: JSON.parse(r.content[0]!.text), note: r.content[1]?.text ?? null };
}

describe("query_notes", () => {
  test("simple form: filter, columns and sort", async () => {
    const r = await call({ filter: 'status == "Done" && n > 55', columns: ["file.name", "n"], sort: [{ property: "n", direction: "DESC" }] });
    expect(r.isError).toBe(false);
    expect(r.body.rows.map((x: { path: string }) => x.path)).toEqual(["work/n58.md", "work/n56.md"]);
    expect(r.body.rows[0].values).toEqual({ "file.name": "n58.md", n: 58 });
    expect(r.body.columns.map((c: { key: string }) => c.key)).toEqual(["file.name", "n"]);
  });

  test("pages 50 rows at a time with a hint for the next page", async () => {
    const first = await call({});
    expect(first.body.rows).toHaveLength(50);
    expect(first.body.total).toBe(62);
    expect(first.note).toContain("offset=50");
    const second = await call({ offset: 50 });
    expect(second.body.rows).toHaveLength(12);
    expect(second.note).toBeNull();
  });

  test("base form, with groups", async () => {
    const r = await call({ base: "filters: file.inFolder(\"work\")\nviews:\n  - type: table\n    name: G\n    groupBy:\n      property: status\n    order: [file.name]\n", limit: 5 });
    expect(r.body.rows.every((x: { group?: string }) => x.group === "Done")).toBe(true);
  });

  test("path form picks the fence that holds the named view, and `this` is that note", async () => {
    const r = await call({ path: "work/Board.md", view: "Finished" });
    expect(r.body.view).toBe("Finished");
    expect(r.body.total).toBe(30);
    expect(r.body.rows.map((x: { path: string }) => x.path)).not.toContain("work/Board.md");
    const first = await call({ path: "work/Board.md" });
    expect(first.body.view).toBe("All");
  });

  test("argument mistakes are errors with a code; engine problems are warnings", async () => {
    const both = await call({ base: "views: []", path: "work/Board.md" });
    expect(both.isError).toBe(true);
    expect(both.body.code).toBe("INVALID_ARGUMENT");
    expect((await call({ path: "work/Board.base" })).body.code).toBe("INVALID_ARGUMENT");
    expect((await call({ path: "work/plain.md" })).body.code).toBe("NO_BASE_BLOCK");
    const warn = await call({ filter: "sum(n) > 1" });
    expect(warn.isError).toBe(false);
    expect(warn.body.rows).toEqual([]);
    expect(warn.body.warnings).toEqual(['unsupported function "sum"']);
  });

  test("the agent instructions mention the tool", () => {
    expect(DEFAULT_MCP_INSTRUCTIONS).toContain("query_notes");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && bun test test/bases.simple.test.ts test/mcp.query-notes.test.ts`
Expected: FAIL: "Cannot find module '../src/bases/simple'", and `query_notes` is an unknown tool.

- [ ] **Step 3: Write `simple.ts`**

```ts
import { stringify } from "yaml";
import type { SortSpec } from "@brainmd/shared/base-types";

// The `filter` / `columns` / `sort` form of query_notes, as the YAML the rest
// of the engine reads. yaml quotes an expression that would otherwise be misread.
export function simpleBase(o: { filter?: string; columns?: string[]; sort?: SortSpec[] }): string {
  const view: Record<string, unknown> = { type: "table", name: "Query" };
  if (o.filter?.trim()) view.filters = o.filter.trim();
  if (o.columns && o.columns.length > 0) view.order = o.columns;
  if (o.sort && o.sort.length > 0) view.sort = o.sort;
  return stringify({ views: [view] }, { lineWidth: 0 });
}
```

- [ ] **Step 4: Register the tool**

In `server/src/mcp/server.ts` add the imports next to the other `../` imports:

```ts
import { findBaseFences } from "@brainmd/shared/base-yaml";
import { parseBase } from "@brainmd/shared/base-parse";
import { runBaseQuery } from "../bases/query";
import { simpleBase } from "../bases/simple";
import { listProperties } from "../properties/registry";
```

Inside `registerHandlers`, directly after the `list_notes` tool and before `graph_view`:

```ts
  server.registerTool(
    "query_notes",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "Run a view over the vault's notes: a table of notes with chosen properties, filtered, sorted and optionally grouped, like an Obsidian Base. " +
        "Pass ONE of: `base` (the YAML of a base; the body of a ```base block works as is), `path` (a note holding a ```base block; `view` picks one by name), " +
        "or the simple form `filter` + `columns` + `sort`. " +
        "A filter is an expression: note properties by name, `file.*` values (name, path, folder, tags, links, backlinks, size, ctime, mtime), " +
        "`==  !=  <  >  &&  ||  !`, and functions such as contains, startsWith, isEmpty, file.hasTag(\"x\"), file.inFolder(\"x\"), today(), now(). " +
        'Example: status == "open" && file.hasTag("work"). Columns are `file.name`, `file.mtime` or a property name. ' +
        "Syntax it cannot run comes back as `warnings`, not an error. 50 rows per page (`limit`, `offset`). Hidden notes are skipped.",
      inputSchema: {
        base: z.string().max(100_000).optional(),
        path: z.string().min(1).optional(),
        view: z.string().optional(),
        filter: z.string().max(2000).optional(),
        columns: z.array(z.string()).max(50).optional(),
        sort: z.array(z.object({ property: z.string(), direction: z.enum(["ASC", "DESC"]) })).max(10).optional(),
        ...pageArgs(50, 200),
      },
    },
    async ({ base, path, view, filter, columns, sort, limit, offset }) => {
      const args = { base: base === undefined ? undefined : "(yaml)", path, view, filter, columns, sort, limit, offset };
      const coded = (code: string, message: string) => Object.assign(new Error(message), { code });
      try {
        const simple = filter !== undefined || columns !== undefined || sort !== undefined;
        if ([base !== undefined, path !== undefined, simple].filter(Boolean).length > 1) {
          throw coded("INVALID_ARGUMENT", "Pass one of: base, path (with view), or filter / columns / sort.");
        }
        let source: string;
        let thisPath: string | undefined;
        if (base !== undefined) {
          source = base;
        } else if (path !== undefined) {
          if (!path.toLowerCase().endsWith(".md")) throw coded("INVALID_ARGUMENT", "path must be a .md note that holds a base block");
          await checkRead(vault, principal, path);
          const fences = findBaseFences((await vault.readNote(path)).content);
          if (fences.length === 0) throw coded("NO_BASE_BLOCK", `${path} has no base block`);
          const hit = view ? fences.find((f) => parseBase(f.source).config.views.some((v) => v.name === view)) : undefined;
          source = (hit ?? fences[0]!).source;
          thisPath = path;
        } else {
          source = simpleBase({ filter, columns, sort });
        }
        const allowed = await readFilter();
        const types = new Map((await listProperties(vault, index, allowed)).map((p) => [p.name, p.type] as const));
        const res = runBaseQuery(
          { source, view: simple ? undefined : view, thisPath, offset: 0, limit: 2000 },
          { index, allowed, types },
        );
        const grouped = res.groups.some((g) => g.label !== "");
        const rows = res.groups.flatMap((g) =>
          g.rows.map((r) => ({ path: r.path, title: r.title, ...(grouped ? { group: g.label } : {}), values: r.values })),
        );
        const p = paginate(rows, limit, offset, 50);
        const warnings =
          res.total > rows.length
            ? [...res.warnings, `Only the first ${rows.length} of ${res.total} rows can be paged; narrow the query.`]
            : res.warnings;
        logCall("query_notes", args, true);
        return pageContent("query_notes", { view: res.view, views: res.views, columns: res.columns, total: res.total, warnings, rows: p.items }, p, "rows");
      } catch (err) {
        return toolError("query_notes", args, err);
      }
    },
  );
```

- [ ] **Step 5: Add the matrix row and update the docs**

In `server/test/route-principal-matrix.test.ts`, after the `search_notes` MCP block at the end of the file:

```ts
describe("route x principal matrix (MCP transport): query_notes is filtered, not forbidden", () => {
  for (const kind of PRINCIPALS) {
    test(kind, async () => {
      const f = await makeFixture(kind);
      const client = await mcpClient(f.handle, f.bearer);
      const result = (await callTool(client, "query_notes", { columns: ["file.name"] })) as { isError?: boolean };
      await client.close();
      expect(result.isError).toBeFalsy();
      const text = JSON.stringify(result);
      if (kind === "owner" || kind === "open") expect(text.includes("secret/a.md")).toBe(true);
      else expect(text.includes("secret/a.md")).toBe(false);
    });
  }
});
```

`README.md`: change `18 tools and 2 resources` (line 32) and `**✓ (18 tools)**` (line 80) to the current count, 20 (Phase 1 made it 19; if the file still says 18, Phase 1 was not applied: stop and check). In `docs/mcp.md`, change `## Tools (19)` to `## Tools (20)` and add this row after `list_notes`:

```markdown
| `query_notes`         | yes       | read        | Notes as a table: a `filter` expression, `columns`, `sort`, or a `base` / `path` view; 50 rows per page, `warnings` for syntax it cannot run |
```

In `mcp-prompt.md` and in the template literal in `server/src/mcp/instructions.ts` (it holds the same text, with `\`` for each backtick), add `query_notes` to the list-tools sentence, so it reads ``List tools (`list_notes`, `search_notes`, `get_tasks`, `get_backlinks`, `list_tags`, `query_notes`)``, and add this bullet after that sentence's bullet:

```markdown
- To list notes by their properties (every task with `status: open`, the notes in a
  folder by date), use `query_notes` instead of reading notes one by one: a `filter`
  such as `status == "open" && file.hasTag("work")`, `columns` such as
  `["file.name", "status"]` and a `sort`. It returns rows with values and a
  `warnings` list for syntax it could not run.
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `cd server && bun test test/bases.simple.test.ts test/mcp.query-notes.test.ts test/route-principal-matrix.test.ts test/mcp.instructions.test.ts test/mcp.apps.test.ts && cd .. && bun run typecheck`
Expected: PASS. `mcp.apps.test.ts` checks that every tool is annotated; `query_notes` carries `READ_ONLY_LOCAL`.

- [ ] **Step 7: Commit**

```bash
git add server/src/bases/simple.ts server/src/mcp/server.ts server/src/mcp/instructions.ts server/test README.md docs/mcp.md mcp-prompt.md
git commit -m "feat(mcp): query_notes, 20 tools" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---


### Task 9: The renderer turns a ```` ```base ```` fence into a placeholder

**Files:**
- Create: `web/src/renderer/plugins/base.ts`
- Modify: `web/src/renderer/render.ts`
- Test: `web/test/bases.render.test.ts`

**Interfaces:**
- Consumes: the `lineOffset` that `renderMarkdown` already computes for the frontmatter.
- Produces: `remarkBaseBlock` (unified plugin, option `{ lineOffset }`). Every top-level fence with language `base` (case-insensitive) becomes `<div class="base-block" data-base="<yaml>" data-source-line="<opening fence line>" data-source-end="<closing fence line>">` with the YAML also inside as `<pre class="base-fallback"><code class="nohighlight">`. Lines are 1-based and absolute (frontmatter included), which is what `fenceEdit` and `findBaseFences` use. Nested fences (list, blockquote) stay plain code blocks. `previewSchema` needs no change: `data*` attributes and `className` are already allowed, and the test proves the output survives sanitising and cannot carry attributes from the YAML.

The plugin replaces the `code` node with a node of its own type instead of setting `hName` on it. `remark-rehype` keeps the `<pre>` it wraps every code block in when only `hName` changes, and that `<pre>` would force `white-space: pre` onto the view.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/renderer/render";

const opts = {
  resolveWikilink: () => null,
  isMediaTarget: () => false,
  buildMediaUrl: (t: string) => `/api/media-raw/${t}`,
};
const html = (md: string) => renderMarkdown(md, opts).html;

const YAML = 'views:\n  - type: table\n    name: "T & <b>"\n';

describe("```base fences", () => {
  test("become a placeholder with the YAML and the line range", () => {
    const out = html(`# Hi\n\n\`\`\`base\n${YAML}\`\`\`\n\nafter\n`);
    expect(out).toContain('class="base-block"');
    expect(out).toContain('data-source-line="3"');
    expect(out).toContain('data-source-end="7"');
    expect(out).toContain('data-base="views:\n  - type: table\n    name: &#x22;T &#x26; <b>&#x22;"');
    expect(out).not.toContain("<script");
  });

  test("line numbers include the frontmatter", () => {
    const out = html(`---\ntitle: x\n---\n\n\`\`\`base\nviews: []\n\`\`\`\n`);
    expect(out).toContain('data-source-line="5"');
    expect(out).toContain('data-source-end="7"');
  });

  test("the YAML stays readable inside the placeholder", () => {
    const out = html("```base\nviews: []\n```\n");
    expect(out).toContain('<pre class="base-fallback"><code class="nohighlight">views: []</code></pre>');
  });

  test("the language tag is case-insensitive; other fences and nested ones are untouched", () => {
    expect(html("```BASE\nviews: []\n```\n")).toContain("base-block");
    expect(html("```yaml\nviews: []\n```\n")).not.toContain("base-block");
    expect(html("> ```base\n> views: []\n> ```\n")).not.toContain("base-block");
    expect(html("- item\n\n  ```base\n  views: []\n  ```\n")).not.toContain("base-block");
  });

  test("a hostile YAML body cannot add attributes or elements", () => {
    const out = html('```base\n" onmouseover="alert(1)" x="\n<img src=x onerror=alert(1)>\n```\n');
    const outsideAttr = out.replace(/data-base="[^"]*"/, "");
    expect(outsideAttr).not.toMatch(/<img|<[a-z][^>]*\son\w+=/i);
    expect(out.match(/<div/g)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/bases.render.test.ts`
Expected: FAIL, the first test: `Expected to contain: "class=\"base-block\""`.

- [ ] **Step 3: Write the plugin and register it**

`web/src/renderer/plugins/base.ts`:

```ts
import type { Plugin } from "unified";
import type { Root } from "mdast";

export interface BaseBlockOptions {
  lineOffset: number;
}

// A ```base fence becomes a placeholder that Preview hydrates into a live
// view. Only top-level fences: the view writes its edits back by line range,
// which is only reliable for blocks that are direct children of the note.
// The YAML also stays inside as a code block, so a render that never
// hydrates (an embed, a copy) still shows something readable.
export const remarkBaseBlock: Plugin<[BaseBlockOptions], Root> = (opts) => (tree) => {
  tree.children.forEach((node, i) => {
    if (node.type !== "code" || (node.lang ?? "").toLowerCase() !== "base" || !node.position) return;
    // A different node type, not hName on the code node: remark-rehype would
    // keep the <pre> it wraps every code block in.
    const data: Record<string, unknown> = {};
    tree.children[i] = { type: "baseBlock", position: node.position, data } as never;
    data.hName = "div";
    data.hProperties = {
      class: "base-block",
      "data-base": node.value,
      "data-source-line": String(node.position.start.line + opts.lineOffset),
      "data-source-end": String(node.position.end.line + opts.lineOffset),
    };
    data.hChildren = [
      {
        type: "element",
        tagName: "pre",
        properties: { className: ["base-fallback"] },
        children: [
          {
            type: "element",
            tagName: "code",
            properties: { className: ["nohighlight"] },
            children: [{ type: "text", value: node.value }],
          },
        ],
      },
    ];
  });
};
```

In `web/src/renderer/render.ts` add the import beside the mermaid one and use the plugin right after `remarkMermaid`:

```ts
import { remarkBaseBlock } from "./plugins/base";
```

```ts
    .use(remarkMermaid)
    .use(remarkBaseBlock, { lineOffset })
```

- [ ] **Step 4: Run the render tests**

Run: `cd web && bun test test/bases.render.test.ts test/render.sanitize.test.ts test/render.sanitize.coverage.test.ts`
Expected: PASS (5 new tests, the existing sanitiser tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add web/src/renderer/plugins/base.ts web/src/renderer/render.ts web/test/bases.render.test.ts
git commit -m "feat(renderer): base fences become view placeholders" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 10: Pure web logic: fence edits, cell model, summaries, moves, view state

**Files:**
- Create: `web/src/bases/edit.ts`, `web/src/bases/model.ts`, `web/src/bases/store.ts`
- Test: `web/test/bases.edit.test.ts`, `web/test/bases.model.test.ts`, `web/test/bases.store.test.ts`

**Interfaces:**
- Consumes: `findBaseFences`, `replaceFenceBody`, `TextEdit` (Task 2); `BaseQueryResponse`, `SortSpec`, `FilterNode`, `Direction` (Task 1); `PropValue`, `PropertyType` (Phase 1).
- Produces (exact): `edit.ts`: `applyEdit(text, edit): string`, `fenceEdit(text, startLine, mutate: (source) => string): TextEdit | null` (null when no base fence opens on that 1-based line; an empty edit when `mutate` changes nothing). `model.ts`: `ColumnType`, `DEFAULT_COLUMN_WIDTH`, `MIN_COLUMN_WIDTH`, `MAX_COLUMN_WIDTH`, `clampWidth`, `effectiveOrder`, `propNameOf(key)` (the frontmatter key a column edits, null for `file.*` and `formula.*`), `isEditable(type, key, value)`, `coerceInput(type, raw): { kind: "set"; value } | { kind: "unset" } | { kind: "error"; message }`, `editText(value)`, `linkParts(text): { target; label } | null`, `SUMMARY_NAMES`, `summarise(name, values): string | null`, `sortByColumn`, `toggleColumn`, `moveColumn`, `flatFilters(f): string[] | null`, `filtersFrom(list): FilterNode | null`, `dragStarted(dx, dy, threshold?)`, `ColumnRect`, `columnAt(cols, x, y)`, `moveChange(type, key): { set } | { unset: true }`, `moveRowInResult`, `patchRowValues`, `FILE_KEYS`, `candidateKeys`, `coverSource(notePath, value)`, `formatScalar(col, value)`. `store.ts`: `blockKey(notePath, ordinal)`, `getActiveView`, `setActiveView`, `getCached(key, fingerprint)`, `getLast(key)` (the last result for a block whatever its fingerprint), `setCached` (bounded to 40 entries), `getOpenTool`, `setOpenTool` (which toolbar popover is open), `onBaseRefresh`, `emitBaseRefresh`.
- Open-note edits use Phase 1's `minimalChange` and `editContent`; this task needs neither.

- [ ] **Step 1: Write the failing tests**

`web/test/bases.edit.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { applyEdit, fenceEdit } from "../src/bases/edit";
import { setViewSort } from "@brainmd/shared/base-yaml";

describe("fenceEdit", () => {
  const note = "# Board\n\nintro\n\n```base\nviews:\n  - type: table\n    name: T\n```\n\nafter\n";

  test("rewrites only the fence body", () => {
    const e = fenceEdit(note, 5, (src) => setViewSort(src, 0, [{ property: "file.name", direction: "ASC" }]));
    expect(e).not.toBeNull();
    expect(applyEdit(note, e!)).toBe(
      "# Board\n\nintro\n\n```base\nviews:\n  - type: table\n    name: T\n    sort:\n      - property: file.name\n        direction: ASC\n```\n\nafter\n",
    );
  });

  test("null when no base fence opens on that line; empty edit when unchanged", () => {
    expect(fenceEdit(note, 3, (s) => s)).toBeNull();
    expect(fenceEdit(note, 5, (s) => s)).toEqual({ from: expect.any(Number), to: expect.any(Number), insert: "" });
  });

  test("CRLF notes keep CRLF", () => {
    const crlf = note.replace(/\n/g, "\r\n");
    const out = applyEdit(crlf, fenceEdit(crlf, 5, (s) => setViewSort(s, 0, [{ property: "a", direction: "DESC" }]))!);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain("    sort:\r\n      - property: a\r\n        direction: DESC\r\n```");
  });
});
```

`web/test/bases.model.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";
import {
  candidateKeys,
  clampWidth,
  coerceInput,
  columnAt,
  coverSource,
  dragStarted,
  editText,
  filtersFrom,
  formatScalar,
  flatFilters,
  isEditable,
  linkParts,
  moveChange,
  moveColumn,
  moveRowInResult,
  patchRowValues,
  propNameOf,
  summarise,
  toggleColumn,
} from "../src/bases/model";

describe("columns and editing", () => {
  test("propNameOf and isEditable", () => {
    expect(propNameOf("status")).toBe("status");
    expect(propNameOf("note.status")).toBe("status");
    expect(propNameOf("file.name")).toBeNull();
    expect(propNameOf("formula.x")).toBeNull();
    expect(isEditable("text", "status", "a")).toBe(true);
    expect(isEditable("file", "file.size", 3)).toBe(false);
    expect(isEditable("text", "meta", { a: 1 })).toBe(false);
    expect(isEditable("formula", "formula.x", 1)).toBe(false);
  });

  test("coerceInput by type", () => {
    expect(coerceInput("number", " 12.5 ")).toEqual({ kind: "set", value: 12.5 });
    expect(coerceInput("number", "abc")).toEqual({ kind: "error", message: "Not a number" });
    expect(coerceInput("number", "")).toEqual({ kind: "unset" });
    expect(coerceInput("text", "  hi ")).toEqual({ kind: "set", value: "hi" });
    expect(coerceInput("date", "2026-12-01")).toEqual({ kind: "set", value: "2026-12-01" });
    expect(coerceInput("multitext", "a, b,, c")).toEqual({ kind: "set", value: ["a", "b", "c"] });
    expect(coerceInput("tags", "#a, b")).toEqual({ kind: "set", value: ["a", "b"] });
    expect(coerceInput("multitext", " , ")).toEqual({ kind: "unset" });
    expect(coerceInput("checkbox", "true")).toEqual({ kind: "set", value: true });
  });

  test("editText", () => {
    expect(editText(null)).toBe("");
    expect(editText(["a", "b"])).toBe("a, b");
    expect(editText(3)).toBe("3");
    expect(editText(false)).toBe("false");
  });

  test("linkParts", () => {
    expect(linkParts("[[people/Ann]]")).toEqual({ target: "people/Ann", label: "Ann" });
    expect(linkParts("[[Ann|The Ann]]")).toEqual({ target: "Ann", label: "The Ann" });
    expect(linkParts("[[Ann#Heading]]")).toEqual({ target: "Ann", label: "Ann" });
    expect(linkParts("plain")).toBeNull();
    expect(linkParts("[[]]")).toBeNull();
  });

  test("width and column order helpers", () => {
    expect(clampWidth(10)).toBe(60);
    expect(clampWidth(5000)).toBe(800);
    expect(clampWidth(150.6)).toBe(151);
    expect(toggleColumn([], "status")).toEqual(["file.name", "status"]);
    expect(toggleColumn(["file.name", "status"], "status")).toEqual(["file.name"]);
    expect(moveColumn(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveColumn(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  });

  test("simple filter editor round trip", () => {
    expect(flatFilters(undefined)).toEqual([]);
    expect(flatFilters("a == 1")).toEqual(["a == 1"]);
    expect(flatFilters({ and: ["a", "b"] })).toEqual(["a", "b"]);
    expect(flatFilters({ or: ["a"] })).toBeNull();
    expect(flatFilters({ and: ["a", { not: ["b"] }] })).toBeNull();
    expect(filtersFrom([" a ", ""])).toEqual({ and: ["a"] });
    expect(filtersFrom([])).toBeNull();
  });
});

describe("summaries", () => {
  const v = [3, 1, 2, null, "x"];
  test("numeric", () => {
    expect(summarise("Sum", v)).toBe("6");
    expect(summarise("Average", v)).toBe("2");
    expect(summarise("Min", v)).toBe("1");
    expect(summarise("Max", v)).toBe("3");
    expect(summarise("Range", v)).toBe("2");
    expect(summarise("Median", [1, 2, 3, 4])).toBe("2.5");
    expect(summarise("Average", [1, 2])).toBe("1.5");
    expect(summarise("Sum", ["a"])).toBeNull();
  });
  test("counts and dates", () => {
    expect(summarise("Empty", [null, "", [], "a"])).toBe("3");
    expect(summarise("Filled", [null, "", [], "a"])).toBe("1");
    expect(summarise("Checked", [true, false, true, null])).toBe("2");
    expect(summarise("Unchecked", [true, false, true, null])).toBe("1");
    expect(summarise("Unique", ["a", "a", "b", null])).toBe("2");
    expect(summarise("Earliest", ["2026-12-01", "2026-01-05"])).toBe("2026-01-05");
    expect(summarise("Latest", ["2026-12-01", "2026-01-05"])).toBe("2026-12-01");
    expect(summarise("Nope", [1])).toBeNull();
  });
});

describe("kanban drag", () => {
  test("drag threshold and drop target", () => {
    expect(dragStarted(3, 3)).toBe(false);
    expect(dragStarted(6, 0)).toBe(true);
    const cols = [
      { key: "Todo", left: 0, right: 100, top: 0, bottom: 400 },
      { key: null, left: 110, right: 210, top: 0, bottom: 400 },
    ];
    expect(columnAt(cols, 50, 10)).toEqual({ key: "Todo" });
    expect(columnAt(cols, 150, 10)).toEqual({ key: null });
    expect(columnAt(cols, 105, 10)).toBeUndefined();
  });

  test("moveChange writes the right type", () => {
    expect(moveChange("text", "Done")).toEqual({ set: "Done" });
    expect(moveChange(undefined, "Done")).toEqual({ set: "Done" });
    expect(moveChange("number", "3")).toEqual({ set: 3 });
    expect(moveChange("number", "x")).toEqual({ set: "x" });
    expect(moveChange("checkbox", "true")).toEqual({ set: true });
    expect(moveChange("multitext", "a")).toEqual({ set: ["a"] });
    expect(moveChange("text", null)).toEqual({ unset: true });
  });
});

const board = (): BaseQueryResponse => ({
  views: [{ name: "B", type: "kanban" }],
  view: "B",
  columns: [{ key: "file.name", label: "Name", type: "file" }],
  groups: [
    { key: "Todo", label: "Todo", count: 2, rows: [{ path: "a.md", title: "a", revision: "1", values: { "file.name": "a.md" } }, { path: "b.md", title: "b", revision: "2", values: {} }] },
    { key: "Done", label: "Done", count: 0, rows: [] },
  ],
  total: 2,
  warnings: [],
});

describe("optimistic result updates", () => {
  test("moveRowInResult moves a card and adjusts counts", () => {
    const r = moveRowInResult(board(), "a.md", "Done");
    expect(r.groups.map((g) => [g.key, g.count, g.rows.map((x) => x.path)])).toEqual([["Todo", 1, ["b.md"]], ["Done", 1, ["a.md"]]]);
  });
  test("a No value column is created on demand; an unknown column leaves the result alone", () => {
    expect(moveRowInResult(board(), "a.md", null).groups.at(-1)).toMatchObject({ key: null, label: "No value", count: 1 });
    const same = board();
    expect(moveRowInResult(same, "a.md", "Blocked")).toBe(same);
    expect(moveRowInResult(same, "zzz.md", "Done")).toBe(same);
  });
  test("patchRowValues touches one row", () => {
    const r = patchRowValues(board(), "b.md", { status: "Doing" });
    expect(r.groups[0]!.rows[1]!.values).toEqual({ status: "Doing" });
    expect(r.groups[0]!.rows[0]!.values).toEqual({ "file.name": "a.md" });
  });
  test("candidateKeys", () => {
    const k = candidateKeys(["status", "file.name"], ["late"]);
    expect(k).toContain("file.mtime");
    expect(k).toContain("status");
    expect(k).toContain("formula.late");
    expect(new Set(k).size).toBe(k.length);
  });
});

describe("cover images", () => {
  test("external URL, media file next to the note, and refusals", () => {
    expect(coverSource("a/b.md", "https://x.test/p.png")).toEqual({ external: "https://x.test/p.png" });
    expect(coverSource("a/b.md", "[[pic.png]]")).toEqual({ media: "a/.media/pic.png" });
    expect(coverSource("b.md", "![[sub/pic.JPG|200]]")).toEqual({ media: ".media/pic.JPG" });
    expect(coverSource("a/b.md", "pic.webp")).toEqual({ media: "a/.media/pic.webp" });
    expect(coverSource("a/b.md", ["[[pic.png]]", "x"])).toEqual({ media: "a/.media/pic.png" });
    expect(coverSource("a/b.md", "notes.txt")).toBeNull();
    expect(coverSource("a/b.md", 3)).toBeNull();
    expect(coverSource("a/b.md", "")).toBeNull();
  });
});

describe("formatScalar", () => {
  const col = (key: string, type: "file" | "text" | "datetime") => ({ key, label: key, type });
  test("plain values", () => {
    expect(formatScalar(col("n", "text"), 3)).toBe("3");
    expect(formatScalar(col("n", "text"), null)).toBe("");
    expect(formatScalar(col("n", "text"), "hi")).toBe("hi");
    expect(formatScalar(col("n", "text"), { a: 1 })).toBe('{"a":1}');
  });
  test("timestamps are shown in local time; text that is not a date stays as written", () => {
    const iso = "2026-11-26T10:00:00.000Z";
    expect(formatScalar(col("file.mtime", "file"), iso)).not.toBe(iso);
    expect(formatScalar(col("when", "datetime"), iso)).not.toBe(iso);
    expect(formatScalar(col("file.mtime", "file"), "later")).toBe("later");
  });
});
```

`web/test/bases.store.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";
import { blockKey, emitBaseRefresh, getActiveView, getCached, getLast, getOpenTool, onBaseRefresh, setActiveView, setCached, setOpenTool } from "../src/bases/store";

const res = (view: string): BaseQueryResponse => ({ views: [], view, columns: [], groups: [], total: 0, warnings: [] });

describe("base store", () => {
  test("active view and cache survive a remount, and only for the same fingerprint", () => {
    const k = blockKey("a.md", 0);
    expect(k).toBe("a.md#0");
    expect(getActiveView(k)).toBeUndefined();
    setActiveView(k, "Board");
    expect(getActiveView(k)).toBe("Board");
    setCached(k, "f1", res("Board"));
    expect(getCached(k, "f1")?.view).toBe("Board");
    expect(getCached(k, "f2")).toBeUndefined();
  });

  test("the last result is kept whatever the fingerprint, and the open popover is remembered", () => {
    const k = blockKey("b.md", 1);
    setCached(k, "old", res("A"));
    expect(getCached(k, "new")).toBeUndefined();
    expect(getLast(k)?.view).toBe("A");
    expect(getOpenTool(k)).toBeNull();
    setOpenTool(k, "filter");
    expect(getOpenTool(k)).toBe("filter");
    setOpenTool(k, null);
    expect(getOpenTool(k)).toBeNull();
  });

  test("cache is bounded", () => {
    for (let i = 0; i < 60; i++) setCached(`n${i}.md#0`, "f", res("x"));
    expect(getCached("n0.md#0", "f")).toBeUndefined();
    expect(getCached("n59.md#0", "f")).toBeDefined();
  });

  test("refresh listeners", () => {
    let n = 0;
    const off = onBaseRefresh(() => n++);
    emitBaseRefresh();
    off();
    emitBaseRefresh();
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && bun test test/bases.edit.test.ts test/bases.model.test.ts test/bases.store.test.ts`
Expected: FAIL, "Cannot find module '../src/bases/edit'" and the same for `model` and `store`.

- [ ] **Step 3: Write the modules**

`web/src/bases/edit.ts`:

```ts
import { findBaseFences, replaceFenceBody, type TextEdit } from "@brainmd/shared/base-yaml";

export type { TextEdit };

export function applyEdit(text: string, e: TextEdit): string {
  return text.slice(0, e.from) + e.insert + text.slice(e.to);
}

// The edit that rewrites the body of the ```base fence opening on `startLine`
// (1-based) with `mutate(oldYaml)`. null when no base fence opens there.
export function fenceEdit(text: string, startLine: number, mutate: (source: string) => string): TextEdit | null {
  const fence = findBaseFences(text).find((f) => f.startLine === startLine);
  if (!fence) return null;
  const next = mutate(fence.source);
  if (next === fence.source) return { from: fence.from, to: fence.from, insert: "" };
  return replaceFenceBody(text, fence, next);
}
```

`web/src/bases/model.ts`:

```ts
import type { BaseQueryResponse, Direction, FilterNode, SortSpec } from "@brainmd/shared/base-types";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";

export type ColumnType = PropertyType | "file" | "formula";

export const DEFAULT_COLUMN_WIDTH = 160;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 800;

export const clampWidth = (n: number): number => Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(n)));

export function effectiveOrder(order: string[]): string[] {
  return order.length > 0 ? order : ["file.name"];
}

// The frontmatter key a column edits, or null for file.* and formula.* columns.
export function propNameOf(key: string): string | null {
  if (key.startsWith("file.") || key.startsWith("formula.")) return null;
  const name = key.startsWith("note.") ? key.slice(5) : key;
  return name === "" ? null : name;
}

const isNested = (v: PropValue): boolean => v !== null && typeof v === "object" && !Array.isArray(v);

export function isEditable(type: ColumnType, key: string, value: PropValue): boolean {
  return type !== "file" && type !== "formula" && propNameOf(key) !== null && !isNested(value);
}

export type Coerced = { kind: "set"; value: PropValue } | { kind: "unset" } | { kind: "error"; message: string };

const LIST_TYPES: PropertyType[] = ["multitext", "tags", "aliases"];

export function coerceInput(type: PropertyType, raw: string): Coerced {
  const text = raw.trim();
  if (LIST_TYPES.includes(type)) {
    const items = text.split(",").map((s) => s.trim().replace(type === "tags" ? /^#/ : /^$/, "")).filter(Boolean);
    return items.length === 0 ? { kind: "unset" } : { kind: "set", value: items };
  }
  if (text === "") return { kind: "unset" };
  if (type === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? { kind: "set", value: n } : { kind: "error", message: "Not a number" };
  }
  if (type === "checkbox") return { kind: "set", value: /^(true|yes|1|on)$/i.test(text) };
  return { kind: "set", value: text };
}

export function editText(value: PropValue): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => editText(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export const WIKI_CELL = /^\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]$/;

export function linkParts(v: string): { target: string; label: string } | null {
  const m = WIKI_CELL.exec(v.trim());
  if (!m || !m[1]!.trim()) return null;
  const target = m[1]!.trim();
  return { target, label: (m[2] ?? target.slice(target.lastIndexOf("/") + 1)).trim() };
}

export const SUMMARY_NAMES = ["Average", "Min", "Max", "Sum", "Median", "Range", "Earliest", "Latest", "Checked", "Unchecked", "Empty", "Filled", "Unique"] as const;
export type SummaryName = (typeof SUMMARY_NAMES)[number];

const isEmptyValue = (v: PropValue): boolean => v === null || v === "" || (Array.isArray(v) && v.length === 0);
const round = (n: number): string => String(Math.round(n * 100) / 100);

// Computed over the rows the view holds. The query contract has no summary
// field, so a paged result summarises only the loaded page.
export function summarise(name: string, values: PropValue[]): string | null {
  const nums = values.filter((v): v is number => typeof v === "number");
  const strs = values.filter((v): v is string => typeof v === "string" && v !== "").sort();
  switch (name) {
    case "Sum":
      return nums.length ? round(nums.reduce((a, b) => a + b, 0)) : null;
    case "Average":
      return nums.length ? round(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
    case "Min":
      return nums.length ? round(Math.min(...nums)) : null;
    case "Max":
      return nums.length ? round(Math.max(...nums)) : null;
    case "Range":
      return nums.length ? round(Math.max(...nums) - Math.min(...nums)) : null;
    case "Median": {
      if (!nums.length) return null;
      const s = [...nums].sort((a, b) => a - b);
      const mid = s.length >> 1;
      return round(s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2);
    }
    case "Earliest":
      return strs[0] ?? null;
    case "Latest":
      return strs[strs.length - 1] ?? null;
    case "Checked":
      return String(values.filter((v) => v === true).length);
    case "Unchecked":
      return String(values.filter((v) => v === false).length);
    case "Empty":
      return String(values.filter(isEmptyValue).length);
    case "Filled":
      return String(values.filter((v) => !isEmptyValue(v)).length);
    case "Unique":
      return String(new Set(values.filter((v) => !isEmptyValue(v)).map((v) => JSON.stringify(v))).size);
    default:
      return null;
  }
}

export function sortByColumn(key: string, direction: Direction | null): SortSpec[] {
  return direction === null ? [] : [{ property: key, direction }];
}

export function toggleColumn(order: string[], key: string): string[] {
  const cur = effectiveOrder(order);
  return cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
}

export function moveColumn(order: string[], key: string, delta: -1 | 1): string[] {
  const cur = [...effectiveOrder(order)];
  const i = cur.indexOf(key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cur.length) return cur;
  [cur[i], cur[j]] = [cur[j]!, cur[i]!];
  return cur;
}

// null: the filter is a tree the simple editor cannot show; edit the source.
export function flatFilters(f: FilterNode | undefined): string[] | null {
  if (f === undefined) return [];
  if (typeof f === "string") return [f];
  if ("and" in f && f.and.every((x) => typeof x === "string")) return f.and as string[];
  return null;
}

export function filtersFrom(list: string[]): FilterNode | null {
  const clean = list.map((s) => s.trim()).filter(Boolean);
  return clean.length === 0 ? null : { and: clean };
}

export function dragStarted(dx: number, dy: number, threshold = 6): boolean {
  return Math.hypot(dx, dy) >= threshold;
}

export interface ColumnRect {
  key: string | null;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// undefined: the pointer is over no column.
export function columnAt(cols: ColumnRect[], x: number, y: number): { key: string | null } | undefined {
  const hit = cols.find((c) => x >= c.left && x <= c.right && y >= c.top && y <= c.bottom);
  return hit ? { key: hit.key } : undefined;
}

// What a card dropped on a kanban column writes to the group property.
export function moveChange(type: PropertyType | undefined, key: string | null): { set: PropValue } | { unset: true } {
  if (key === null) return { unset: true };
  if (type === "number" && key.trim() !== "" && Number.isFinite(Number(key))) return { set: Number(key) };
  if (type === "checkbox") return { set: key === "true" };
  if (type && LIST_TYPES.includes(type)) return { set: [key] };
  return { set: key };
}

// Where a cards view finds a cover image: an external URL, or a file in the
// note folder's .media directory (the same place Preview looks for embeds).
export function coverSource(notePath: string, value: PropValue): { external: string } | { media: string } | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (typeof v !== "string" || v.trim() === "") return null;
  const t = v.trim();
  if (/^https?:\/\//i.test(t)) return { external: t };
  const m = /^!?\[\[([^\]|#]+)/.exec(t);
  const name = (m ? m[1]! : t).trim().split("/").pop()!;
  if (!/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name)) return null;
  const dir = notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/") + 1) : "";
  return { media: `${dir}.media/${name}` };
}

type ResultRow = BaseQueryResponse["groups"][number]["rows"][number];

// Local update after a kanban move, so the card lands before the refetch.
// A target column that is not on screen leaves the result alone.
export function moveRowInResult(res: BaseQueryResponse, path: string, toKey: string | null): BaseQueryResponse {
  let moved: ResultRow | undefined;
  const groups = res.groups.map((g) => {
    const i = g.rows.findIndex((r) => r.path === path);
    if (i < 0) return g;
    moved = g.rows[i];
    return { ...g, rows: g.rows.filter((_, j) => j !== i), count: g.count - 1 };
  });
  if (!moved) return res;
  const to = groups.findIndex((g) => g.key === toKey);
  if (to >= 0) {
    const g = groups[to]!;
    groups[to] = { ...g, rows: [...g.rows, moved], count: g.count + 1 };
  } else if (toKey === null) {
    groups.push({ key: null, label: "No value", count: 1, rows: [moved] });
  } else {
    return res;
  }
  return { ...res, groups };
}

export function patchRowValues(res: BaseQueryResponse, path: string, patch: Record<string, PropValue>): BaseQueryResponse {
  return {
    ...res,
    groups: res.groups.map((g) => ({
      ...g,
      rows: g.rows.map((r) => (r.path === path ? { ...r, values: { ...r.values, ...patch } } : r)),
    })),
  };
}

export const FILE_KEYS = ["file.name", "file.basename", "file.folder", "file.path", "file.ext", "file.size", "file.ctime", "file.mtime", "file.tags", "file.links", "file.backlinks", "file.embeds"];

// Every key a sort, group or column picker can offer.
export function candidateKeys(vaultNames: string[], formulaNames: string[], extra: string[] = []): string[] {
  return [...new Set([...FILE_KEYS, ...vaultNames, ...formulaNames.map((f) => `formula.${f}`), ...extra])];
}

export function formatScalar(col: Pick<BaseQueryResponse["columns"][number], "key" | "type">, v: PropValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && (col.key === "file.ctime" || col.key === "file.mtime" || col.type === "datetime")) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
```

`web/src/bases/store.ts`:

```ts
import type { BaseQueryResponse } from "@brainmd/shared/base-types";

const active = new Map<string, string>();
const cache = new Map<string, { fingerprint: string; result: BaseQueryResponse }>();
const listeners = new Set<() => void>();
const CACHE_LIMIT = 40;

// Preview replaces its HTML on every edit, which destroys the mounted views.
// What the user picked, the open popover and the last result live here so a
// fresh mount continues where the old one stopped.
export const blockKey = (notePath: string | null, ordinal: number): string => `${notePath ?? ""}#${ordinal}`;

export const getActiveView = (key: string): string | undefined => active.get(key);
export const setActiveView = (key: string, name: string): void => void active.set(key, name);

export function getCached(key: string, fingerprint: string): BaseQueryResponse | undefined {
  const hit = cache.get(key);
  return hit && hit.fingerprint === fingerprint ? hit.result : undefined;
}

// The last result for a block whatever its fingerprint, so a remount after an
// edit paints the old rows at once while the new query runs.
export const getLast = (key: string): BaseQueryResponse | undefined => cache.get(key)?.result;

const openTools = new Map<string, string>();
export const getOpenTool = (key: string): string | null => openTools.get(key) ?? null;
export function setOpenTool(key: string, tool: string | null): void {
  if (tool === null) openTools.delete(key);
  else openTools.set(key, tool);
}

export function setCached(key: string, fingerprint: string, result: BaseQueryResponse): void {
  cache.delete(key);
  cache.set(key, { fingerprint, result });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

export function onBaseRefresh(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitBaseRefresh(): void {
  for (const fn of [...listeners]) fn();
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `cd web && bun test test/bases.edit.test.ts test/bases.model.test.ts test/bases.store.test.ts && cd .. && bun run typecheck`
Expected: PASS (3 + 17 + 4 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/bases/edit.ts web/src/bases/model.ts web/src/bases/store.ts web/test/bases.edit.test.ts web/test/bases.model.test.ts web/test/bases.store.test.ts
git commit -m "feat(web): pure logic for views: fence edits, cells, summaries, moves, state cache" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 11: The "+ New" note rule

**Files:**
- Create: `web/src/bases/new-note.ts`
- Test: `web/test/bases.new-note.test.ts`

**Interfaces:**
- Consumes: `FilterNode` (Task 1), `PropValue` (Phase 1), `yaml` (already a web dependency).
- Produces (exact): `interface NewNotePlan { folder; props }`, `planNewNote(filters: Array<FilterNode | undefined>, preset?: Record<string, PropValue>): NewNotePlan`, `uniqueNotePath(folder, exists(path): boolean, base?): string`, `buildNoteContent(title, props): string`.
- The rule (spec): the folder comes from the first `file.inFolder("x")` or `file.folder == "x"` found in the global and view filters; properties come from plain equality filters (`status == "Todo"`, `note.status == "Todo"`, `note["due date"] == "soon"`, numbers and booleans too); `file.hasTag("t")` adds to `tags`. Only the top-level list and nested `and` are read: anything under `or` or `not` says nothing definite and is skipped, as are non-literal right-hand sides and `file.*` / `formula.*` keys. A `preset` (a kanban column's value) wins over a filter. The note is `# <name>` with the properties as frontmatter; `yaml`'s `stringify` quotes wikilinks and anything else that needs it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { buildNoteContent, planNewNote, uniqueNotePath } from "../src/bases/new-note";

describe("+ New note rule", () => {
  test("folder from inFolder, properties from equality, tags from hasTag", () => {
    const plan = planNewNote([
      { and: ['file.inFolder("Projects/2026")', 'status == "Todo"', "n == 3", "done == false", 'file.hasTag("work")'] },
      'note["due date"] == "soon"',
    ]);
    expect(plan).toEqual({ folder: "Projects/2026", props: { status: "Todo", n: 3, done: false, tags: ["work"], "due date": "soon" } });
  });

  test("or and not say nothing definite; non-literals and file/formula keys are skipped", () => {
    const plan = planNewNote([{ or: ['status == "A"'] }, { and: [{ not: ['status == "B"'] }, "n > 3", 'file.name == "x"', 'a == b', 'note.owner == "Ann"'] }]);
    expect(plan).toEqual({ folder: "", props: { owner: "Ann" } });
  });

  test("first folder wins; a preset (kanban column) overrides; tags merge", () => {
    const plan = planNewNote(['file.inFolder("A")', 'file.folder == "B"', 'status == "Todo"', "tags == \"x\"", 'file.hasTag("#y")'], { status: "Doing" });
    expect(plan).toEqual({ folder: "A", props: { status: "Doing", tags: ["x", "y"] } });
  });

  test("unique path and content", () => {
    expect(uniqueNotePath("A", () => false)).toBe("A/Untitled.md");
    const taken = new Set(["Untitled.md", "Untitled 1.md"]);
    expect(uniqueNotePath("", (p) => taken.has(p))).toBe("Untitled 2.md");
    expect(buildNoteContent("T", {})).toBe("# T\n\n");
    expect(buildNoteContent("T", { status: "Todo", owner: "[[Ann]]", tags: ["a"], n: 2 })).toBe(
      '---\nstatus: Todo\nowner: "[[Ann]]"\ntags:\n  - a\nn: 2\n---\n\n# T\n\n',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && bun test test/bases.new-note.test.ts`
Expected: FAIL, "Cannot find module '../src/bases/new-note'".

- [ ] **Step 3: Write the implementation**

```ts
import { stringify } from "yaml";
import type { FilterNode } from "@brainmd/shared/base-types";
import type { PropValue } from "@brainmd/shared/frontmatter";

export interface NewNotePlan {
  folder: string;
  props: Record<string, PropValue>;
}

const STR = `(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`;
const RE_FOLDER = new RegExp(`^file\\.inFolder\\(\\s*${STR}\\s*\\)$`);
const RE_FOLDER_EQ = new RegExp(`^file\\.folder\\s*==\\s*${STR}$`);
const RE_TAG = new RegExp(`^file\\.hasTag\\(\\s*${STR}\\s*\\)$`);
const RE_EQ = new RegExp(`^(?:note\\.)?([\\p{L}_][\\p{L}\\p{N}_]*)\\s*==\\s*(.+)$`, "u");
const RE_EQ_BRACKET = new RegExp(`^note\\[\\s*${STR}\\s*\\]\\s*==\\s*(.+)$`);

const unq = (m: RegExpExecArray, i = 1): string => (m[i] ?? m[i + 1] ?? "").replace(/\\(.)/g, "$1");

function literal(src: string): PropValue | undefined {
  const t = src.trim();
  const s = new RegExp(`^${STR}$`).exec(t);
  if (s) return (s[1] ?? s[2] ?? "").replace(/\\(.)/g, "$1");
  if (t === "true") return true;
  if (t === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return undefined;
}

function leaves(f: FilterNode | undefined, out: string[]): void {
  if (f === undefined) return;
  if (typeof f === "string") out.push(f.trim());
  else if ("and" in f) for (const k of f.and) leaves(k, out);
}

// The note a "+ New" button creates: the folder an inFolder / folder filter
// names and the properties that plain equality and hasTag filters imply.
// Filters under or / not say nothing definite, so they are skipped.
export function planNewNote(filters: Array<FilterNode | undefined>, preset: Record<string, PropValue> = {}): NewNotePlan {
  const list: string[] = [];
  for (const f of filters) leaves(f, list);
  let folder = "";
  const props: Record<string, PropValue> = {};
  const tags: string[] = [];
  for (const l of list) {
    let m = RE_FOLDER.exec(l) ?? RE_FOLDER_EQ.exec(l);
    if (m) {
      if (folder === "") folder = unq(m).replace(/^\/+|\/+$/g, "");
      continue;
    }
    m = RE_TAG.exec(l);
    if (m) {
      tags.push(unq(m).replace(/^#/, ""));
      continue;
    }
    const b = RE_EQ_BRACKET.exec(l);
    const e = b ?? RE_EQ.exec(l);
    if (e) {
      const name = b ? unq(b) : e[1]!;
      const v = literal(b ? (b[3] ?? "") : e[2]!);
      if (v !== undefined && !["file", "formula", "this", "note"].includes(name)) props[name] = v;
    }
  }
  if (tags.length > 0) {
    const had = Array.isArray(props.tags) ? (props.tags as string[]) : typeof props.tags === "string" ? [props.tags] : [];
    props.tags = [...new Set([...had, ...tags])];
  }
  return { folder, props: { ...props, ...preset } };
}

export function uniqueNotePath(folder: string, exists: (path: string) => boolean, base = "Untitled"): string {
  const dir = folder ? `${folder}/` : "";
  for (let i = 0; i < 1000; i++) {
    const p = `${dir}${base}${i === 0 ? "" : ` ${i}`}.md`;
    if (!exists(p)) return p;
  }
  return `${dir}${base} ${Date.now()}.md`;
}

export function buildNoteContent(title: string, props: Record<string, PropValue>): string {
  const fm = Object.keys(props).length > 0 ? `---\n${stringify(props, { lineWidth: 0 }).trimEnd()}\n---\n\n` : "";
  return `${fm}# ${title}\n\n`;
}
```

- [ ] **Step 4: Run the test**

Run: `cd web && bun test test/bases.new-note.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/bases/new-note.ts web/test/bases.new-note.test.ts
git commit -m "feat(web): the + New note rule for views" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---


### Task 12: View foundations: client methods, host, layout props, cell display, row menu

**Files:**
- Create: `web/src/bases/host.ts`, `web/src/bases/types.ts`, `web/src/bases/CellValue.tsx`, `web/src/bases/RowMenu.tsx`
- Modify: `web/src/api/client.ts`

**Interfaces:**
- Consumes: `BaseQueryRequest`, `BaseQueryResponse` (Task 1); `ViewConfig`, `BaseConfig` (Task 1); `linkParts`, `formatScalar` (Task 10); Phase 1's `api.properties()` and `WriteNoteResult`, `ConflictError` already in `client.ts`; the `ui/dropdown-menu` primitives.
- Produces (exact): `api.baseQuery(req, signal?): Promise<BaseQueryResponse>`, `api.patchNoteProperties(path, { set?, unset?, baseRevision? }): Promise<WriteNoteResult>` (409 throws `ConflictError`, like `writeNote`); `interface BaseHost { currentPath(); edit(fn: (current: string) => string); editFence(startLine, mutate): boolean; openNote(path); openLink(target, fromPath); noteExists(path); createNote(path, content): Promise<"created" | "exists" | "failed">; toast(message) }`; `type Row`, `type Column`, `type PropChange`, `interface LayoutProps { result; config; view; vaultTypes; host; saveProps(row, change, optimistic?): Promise<boolean>; editView(fn: (source, viewIndex) => string); newNote(preset?): Promise<void> }`; `CellValue({ col, value, row, host })`; `RowMenu({ row, host, children? })`, the keyboard and touch twin of every drag: its children are extra `DropdownMenuItem`s.
- Note: if Phase 1 already added a client method for `PATCH /api/note-properties/*`, keep one implementation and point `BaseView` (Task 17) at it.

There is no DOM test runner in this repo, so these files are checked by the typecheck here and by the screenshot run in Task 19.

- [ ] **Step 1: Add the client methods**

In `web/src/api/client.ts`, add to the type imports at the top (Phase 1 already imports `PropertyInfo` and `PropertyType`):

```ts
import type { BaseQueryRequest, BaseQueryResponse } from "@brainmd/shared/base-types";
import type { PropValue } from "@brainmd/shared/frontmatter";
```

Inside the `api` object, after `properties()`:

```ts
  async baseQuery(req: BaseQueryRequest, signal?: AbortSignal): Promise<BaseQueryResponse> {
    return jsonOrThrow(
      await fetch(`${BASE}/api/bases/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        signal,
      }),
    );
  },
  async patchNoteProperties(
    path: string,
    body: { set?: Record<string, PropValue>; unset?: string[]; baseRevision?: string },
  ): Promise<WriteNoteResult> {
    const res = await fetch(`${BASE}/api/note-properties/${encodePath(path)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      const err = await res.json().catch(() => ({}) as Record<string, unknown>);
      throw new ConflictError(typeof err.revision === "string" ? err.revision : "");
    }
    const out = await jsonOrThrow<WriteNoteResult>(res);
    afterMutation();
    return out;
  },
```

- [ ] **Step 2: Create the host and layout types**

`web/src/bases/host.ts`:

```ts
// What a mounted view needs from the app around it. Built once in App.tsx
// and kept stable, so Preview can mount views without re-rendering them.
export interface BaseHost {
  currentPath(): string | null;
  // Rewrites the open note: one CodeMirror transaction when the editor is
  // mounted, else the content state. `fn` may throw; nothing is applied then.
  edit(fn: (current: string) => string): void;
  // Rewrites the body of the ```base fence that opens on `startLine`. false when no such fence exists.
  editFence(startLine: number, mutate: (source: string) => string): boolean;
  openNote(path: string): void;
  openLink(target: string, fromPath: string): void;
  noteExists(path: string): boolean;
  createNote(path: string, content: string): Promise<"created" | "exists" | "failed">;
  toast(message: string): void;
}
```

`web/src/bases/types.ts`:

```ts
import type { BaseConfig, ViewConfig } from "@brainmd/shared/base-parse";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import type { BaseHost } from "./host";

export type Row = BaseQueryResponse["groups"][number]["rows"][number];
export type Column = BaseQueryResponse["columns"][number];
export type PropChange = { set?: Record<string, PropValue>; unset?: string[] };

export interface LayoutProps {
  result: BaseQueryResponse;
  config: BaseConfig;
  view: ViewConfig;
  vaultTypes: Map<string, PropertyType>;
  host: BaseHost;
  saveProps(row: Row, change: PropChange, optimistic?: (r: BaseQueryResponse) => BaseQueryResponse): Promise<boolean>;
  editView(fn: (source: string, viewIndex: number) => string): void;
  newNote(preset?: Record<string, PropValue>): Promise<void>;
}
```

- [ ] **Step 3: Create the cell display and the row menu**

`web/src/bases/CellValue.tsx`:

```tsx
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { BaseHost } from "./host";
import { formatScalar, linkParts } from "./model";
import type { Column, Row } from "./types";

const stripMd = (s: string): string => s.replace(/\.md$/i, "");

interface CellProps {
  col: Column;
  value: PropValue;
  row: Row;
  host: BaseHost;
}

function Scalar({ col, value, row, host }: CellProps) {
  if (typeof value === "string") {
    const link = linkParts(value);
    if (link) {
      return (
        <button type="button" className="base-link" onClick={(e) => { e.stopPropagation(); host.openLink(link.target, row.path); }}>
          {link.label}
        </button>
      );
    }
  }
  if (typeof value === "boolean") return <input type="checkbox" checked={value} readOnly disabled aria-label={col.label} />;
  return <>{formatScalar(col, value)}</>;
}

export function CellValue(p: CellProps) {
  const { col, value, row, host } = p;
  if (col.key === "file.name" && typeof value === "string") {
    return (
      <button type="button" className="base-link" onClick={(e) => { e.stopPropagation(); host.openNote(row.path); }}>
        {stripMd(value)}
      </button>
    );
  }
  if (Array.isArray(value)) {
    return (
      <span className="base-chips">
        {value.map((v, i) => (
          <span className="base-chip" key={i}>
            <Scalar col={col} value={v} row={row} host={host} />
          </span>
        ))}
      </span>
    );
  }
  return <Scalar {...p} />;
}
```

`web/src/bases/RowMenu.tsx`:

```tsx
import type { ReactNode } from "react";
import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import type { BaseHost } from "./host";
import type { Row } from "./types";

// The keyboard and touch twin of every drag and hover action on a row.
export function RowMenu({ row, host, children }: { row: Row; host: BaseHost; children?: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn base-btn icon base-more" aria-label={`Actions for ${row.title}`} onClick={(e) => e.stopPropagation()}>
          <DotsHorizontalIcon aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => host.openNote(row.path)}>Open note</DropdownMenuItem>
        {children ? <DropdownMenuSeparator /> : null}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: clean. (`LayoutProps.newNote` and the host are consumed by the next tasks; unused exports do not fail the build.)

- [ ] **Step 5: Commit**

```bash
git add web/src/api/client.ts web/src/bases/host.ts web/src/bases/types.ts web/src/bases/CellValue.tsx web/src/bases/RowMenu.tsx
git commit -m "feat(web): view foundations: client methods, host, layout props, cells, row menu" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 13: Table layout: sticky header, resize, cell editing, summaries

**Files:**
- Create: `web/src/bases/EditableCell.tsx`, `web/src/bases/TableView.tsx`

**Interfaces:**
- Consumes: `LayoutProps`, `Row`, `Column`, `PropChange` (Task 12); `CellValue`, `RowMenu` (Task 12); `coerceInput`, `editText`, `isEditable`, `propNameOf`, `clampWidth`, `DEFAULT_COLUMN_WIDTH`, `moveColumn`, `toggleColumn`, `SUMMARY_NAMES`, `summarise`, `patchRowValues` (Task 10); `setColumnSize`, `setViewGroupBy`, `setViewOrder`, `setViewSort`, `setViewSummary` (Task 2).
- Produces: `EditableCell({ col, value, row, host, onCommit(change) })`, `TableView(props: LayoutProps)`.
- Behaviour: the header is sticky (CSS in Task 17); each header opens a column menu (sort ascending or descending, clear sort, group by this, move left or right, wider, narrower, hide, summary), which is the touch and keyboard twin of the resize handle; the handle itself takes pointer drags (`setPointerCapture`, live width in local state, one YAML write on release) and, when focused, ArrowLeft / ArrowRight (10 px, live width only) with Enter or blur committing, because a commit rewrites the fence and remounts the view, which drops focus. Widths are written to the view as `columnSize`. A cell edit on any property column opens an input typed by the column (number, date, text, list as comma separated; a checkbox toggles at once); Enter or blur commits, Escape cancels, an unchanged or invalid value writes nothing. Computed columns (`file.*`, `formula.*`) and nested values are read-only. A checkbox sits in a label that is 40px at `pointer: coarse`. The write goes through `saveProps`, which already patches the row optimistically. A summary footer shows the chosen summary per column.

- [ ] **Step 1: Create the editable cell**

```tsx
import { useRef, useState } from "react";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { CellValue } from "./CellValue";
import type { BaseHost } from "./host";
import { coerceInput, editText, isEditable, propNameOf } from "./model";
import type { Column, PropChange, Row } from "./types";

interface Props {
  col: Column;
  value: PropValue;
  row: Row;
  host: BaseHost;
  onCommit(change: PropChange): void;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inputType(type: PropertyType, value: PropValue): string {
  if (type === "number") return "number";
  if (type === "date" && (value === null || (typeof value === "string" && DATE_RE.test(value)))) return "date";
  return "text";
}

export function EditableCell({ col, value, row, host, onCommit }: Props) {
  const name = propNameOf(col.key);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  if (name === null || !isEditable(col.type, col.key, value)) return <CellValue col={col} value={value} row={row} host={host} />;
  const type = col.type as PropertyType;

  if (type === "checkbox") {
    return (
      <label className="base-check-wrap">
        <input
          type="checkbox"
          className="base-check"
          checked={value === true}
          aria-label={`${col.label}, ${row.title}`}
          onChange={(e) => onCommit({ set: { [name]: e.target.checked } })}
        />
      </label>
    );
  }

  if (!editing) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: a button cannot hold the link buttons CellValue renders
      <div
        className="base-cell-edit"
        role="button"
        tabIndex={0}
        aria-label={`Edit ${col.label}, ${row.title}`}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setEditing(true);
          }
        }}
      >
        <CellValue col={col} value={value} row={row} host={host} />
      </div>
    );
  }

  const finish = (raw: string) => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (editText(value) === raw.trim()) return;
    const c = coerceInput(type, raw);
    if (c.kind === "error") host.toast(`${col.label}: ${c.message}`);
    else onCommit(c.kind === "set" ? { set: { [name]: c.value } } : { unset: [name] });
  };

  return (
    <input
      className="base-input base-cell-input"
      type={inputType(type, value)}
      step={type === "number" ? "any" : undefined}
      defaultValue={editText(value)}
      aria-label={`${col.label}, ${row.title}`}
      // biome-ignore lint/a11y/noAutofocus: the input appears because the user just activated the cell
      autoFocus
      spellCheck={false}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}
```

- [ ] **Step 2: Create the table**

```tsx
import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { columnId, setColumnSize, setViewGroupBy, setViewOrder, setViewSort, setViewSummary } from "@brainmd/shared/base-yaml";
import type { PropValue } from "@brainmd/shared/frontmatter";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { EditableCell } from "./EditableCell";
import { RowMenu } from "./RowMenu";
import { DEFAULT_COLUMN_WIDTH, SUMMARY_NAMES, clampWidth, moveColumn, patchRowValues, propNameOf, summarise, toggleColumn } from "./model";
import type { Column, LayoutProps, PropChange, Row } from "./types";

export function TableView({ result, view, config, host, saveProps, editView }: LayoutProps) {
  const [live, setLive] = useState<Record<string, number>>({});
  useEffect(() => setLive({}), [view.columnSize]);
  const grouped = result.groups.some((g) => g.label !== "");
  const allRows = result.groups.flatMap((g) => g.rows);
  const widthOf = (key: string): number => live[key] ?? view.columnSize[columnId(key)] ?? DEFAULT_COLUMN_WIDTH;

  const commitWidth = (key: string, w: number) => {
    setLive((l) => ({ ...l, [key]: w }));
    editView((src, i) => setColumnSize(src, i, key, w));
  };

  const bumpWidth = (key: string, delta: number) => setLive((l) => ({ ...l, [key]: clampWidth((l[key] ?? view.columnSize[columnId(key)] ?? DEFAULT_COLUMN_WIDTH) + delta) }));
  const commitLive = (key: string) => {
    const w = live[key];
    if (w !== undefined && w !== (view.columnSize[columnId(key)] ?? DEFAULT_COLUMN_WIDTH)) commitWidth(key, w);
  };

  const startResize = (e: ReactPointerEvent<HTMLElement>, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = widthOf(key);
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = clampWidth(startW + ev.clientX - startX);
      setLive((l) => ({ ...l, [key]: w }));
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      if (w !== startW) commitWidth(key, w);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const save = (row: Row, change: PropChange) => {
    const patch: Record<string, PropValue> = {};
    for (const name of [...Object.keys(change.set ?? {}), ...(change.unset ?? [])]) {
      for (const c of result.columns) if (propNameOf(c.key) === name) patch[c.key] = change.set && name in change.set ? change.set[name]! : null;
    }
    void saveProps(row, change, (r) => patchRowValues(r, row.path, patch));
  };

  const summaryFor = (c: Column): string | undefined => view.summaries[c.key] ?? config.summaries[c.key];
  const showSummaries = result.columns.some((c) => summaryFor(c));
  const sortedBy = (key: string) => view.sort.find((s) => s.property === key)?.direction;

  const header = (c: Column) => (
    <th key={c.key} scope="col" aria-sort={sortedBy(c.key) === "ASC" ? "ascending" : sortedBy(c.key) === "DESC" ? "descending" : "none"}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="base-th-btn" aria-label={`Column ${c.label}`}>
            {c.label}
            {sortedBy(c.key) ? <span aria-hidden>{sortedBy(c.key) === "ASC" ? " ↑" : " ↓"}</span> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => editView((src, i) => setViewSort(src, i, [{ property: c.key, direction: "ASC" }]))}>Sort ascending</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editView((src, i) => setViewSort(src, i, [{ property: c.key, direction: "DESC" }]))}>Sort descending</DropdownMenuItem>
          <DropdownMenuItem disabled={!sortedBy(c.key)} onSelect={() => editView((src, i) => setViewSort(src, i, view.sort.filter((s) => s.property !== c.key)))}>Clear sort</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editView((src, i) => setViewGroupBy(src, i, { property: c.key, direction: "ASC" }))}>Group by this</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => editView((src, i) => setViewOrder(src, i, moveColumn(view.order, c.key, -1)))}>Move left</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editView((src, i) => setViewOrder(src, i, moveColumn(view.order, c.key, 1)))}>Move right</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => commitWidth(c.key, clampWidth(widthOf(c.key) + 40))}>Wider</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => commitWidth(c.key, clampWidth(widthOf(c.key) - 40))}>Narrower</DropdownMenuItem>
          <DropdownMenuItem disabled={result.columns.length < 2} onSelect={() => editView((src, i) => setViewOrder(src, i, toggleColumn(view.order, c.key)))}>Hide column</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Summary</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => editView((src, i) => setViewSummary(src, i, c.key, null))}>None</DropdownMenuItem>
              {SUMMARY_NAMES.map((n) => (
                <DropdownMenuItem key={n} onSelect={() => editView((src, i) => setViewSummary(src, i, c.key, n))}>{n}</DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      <span
        className="base-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${c.label}`}
        tabIndex={0}
        onPointerDown={(e) => startResize(e, c.key)}
        onBlur={() => commitLive(c.key)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") bumpWidth(c.key, -10);
          else if (e.key === "ArrowRight") bumpWidth(c.key, 10);
          else if (e.key === "Enter") commitLive(c.key);
          else return;
          e.preventDefault();
        }}
      />
    </th>
  );

  return (
    <div className="base-table-wrap">
      <table className="base-table">
        <colgroup>
          {result.columns.map((c) => (
            <col key={c.key} style={{ width: widthOf(c.key) }} />
          ))}
          <col className="base-col-menu" />
        </colgroup>
        <thead>
          <tr>
            {result.columns.map(header)}
            <th aria-label="Row actions" />
          </tr>
        </thead>
        {result.groups.map((g) => (
          <tbody key={g.key ?? "\u0000none"}>
            {grouped ? (
              <tr className="base-group">
                <td colSpan={result.columns.length + 1}>
                  {g.label} <span className="base-count">{g.count}</span>
                </td>
              </tr>
            ) : null}
            {g.rows.map((r) => (
              <tr key={r.path}>
                {result.columns.map((c) => (
                  <td key={c.key}>
                    <EditableCell col={c} value={r.values[c.key] ?? null} row={r} host={host} onCommit={(change) => save(r, change)} />
                  </td>
                ))}
                <td className="base-td-menu">
                  <RowMenu row={r} host={host} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
        {showSummaries ? (
          <tfoot>
            <tr>
              {result.columns.map((c) => {
                const name = summaryFor(c);
                const v = name ? summarise(name, allRows.map((r) => r.values[c.key] ?? null)) : null;
                return (
                  <td key={c.key} title={name ? `${name} over the ${allRows.length} loaded rows` : undefined}>
                    {name && v !== null ? `${name} ${v}` : ""}
                  </td>
                );
              })}
              <td />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/bases/EditableCell.tsx web/src/bases/TableView.tsx
git commit -m "feat(web): table layout with sticky header, resize, cell editing and summaries" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 14: Cards and list layouts

**Files:**
- Create: `web/src/bases/CardsView.tsx`, `web/src/bases/ListView.tsx`

**Interfaces:**
- Consumes: `LayoutProps` (Task 12), `CellValue`, `RowMenu` (Task 12), `coverSource` (Task 10), `api.mediaUrl` (existing).
- Produces: `CardsView(props: LayoutProps)` (grid of cards: title link, the chosen properties as label and value, optional cover from the view's `image` property, `...` menu), `ListView(props: LayoutProps)` (one compact row per note: title, properties inline, `...` menu). Both show group titles when the view is grouped, skip empty property values, and are read-only. A cover under `.media/` is fetched through the app's patched `fetch` and shown from a blob URL, because a plain `<img>` request carries no bearer token when auth is on (the same reason `Preview` protects media).

- [ ] **Step 1: Create the cards layout**

```tsx
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { CellValue } from "./CellValue";
import { RowMenu } from "./RowMenu";
import { coverSource } from "./model";
import type { LayoutProps, Row } from "./types";

// Media requests are not covered by the app's patched fetch when they are
// plain <img> loads, so with auth on they would 401. Fetch the bytes instead.
function MediaImg({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    fetch(api.mediaUrl(path))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return url ? <img src={url} alt="" loading="lazy" /> : <div className="base-cover-ph" />;
}

function Cover({ row, value }: { row: Row; value: Row["values"][string] | undefined }) {
  const src = value === undefined ? null : coverSource(row.path, value);
  if (!src) return null;
  return (
    <div className="base-cover">
      {"external" in src ? <img src={src.external} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <MediaImg path={src.media} />}
    </div>
  );
}

export function CardsView({ result, view, host }: LayoutProps) {
  const cols = result.columns.filter((c) => c.key !== "file.name");
  const grouped = result.groups.some((g) => g.label !== "");
  return (
    <div className="base-cards-wrap">
      {result.groups.map((g) => (
        <section key={g.key ?? "\u0000none"}>
          {grouped ? (
            <h4 className="base-group-title">
              {g.label} <span className="base-count">{g.count}</span>
            </h4>
          ) : null}
          <div className="base-cards">
            {g.rows.map((r) => (
              <article className="base-card" key={r.path}>
                {view.image ? <Cover row={r} value={r.values[view.image]} /> : null}
                <div className="base-card-head">
                  <button type="button" className="base-link base-card-title" onClick={() => host.openNote(r.path)}>
                    {r.title}
                  </button>
                  <RowMenu row={r} host={host} />
                </div>
                <dl className="base-card-props">
                  {cols.map((c) => {
                    const v = r.values[c.key] ?? null;
                    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                    return (
                      <div key={c.key}>
                        <dt>{c.label}</dt>
                        <dd>
                          <CellValue col={c} value={v} row={r} host={host} />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create the list layout**

```tsx
import { CellValue } from "./CellValue";
import { RowMenu } from "./RowMenu";
import type { LayoutProps } from "./types";

export function ListView({ result, host }: LayoutProps) {
  const cols = result.columns.filter((c) => c.key !== "file.name");
  const grouped = result.groups.some((g) => g.label !== "");
  return (
    <div className="base-list-wrap">
      {result.groups.map((g) => (
        <section key={g.key ?? "\u0000none"}>
          {grouped ? (
            <h4 className="base-group-title">
              {g.label} <span className="base-count">{g.count}</span>
            </h4>
          ) : null}
          <ul className="base-list">
            {g.rows.map((r) => (
              <li key={r.path}>
                <button type="button" className="base-link" onClick={() => host.openNote(r.path)}>
                  {r.title}
                </button>
                <span className="base-list-meta">
                  {cols.map((c) => {
                    const v = r.values[c.key] ?? null;
                    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                    return (
                      <span key={c.key} className="base-list-prop" title={c.label}>
                        <CellValue col={c} value={v} row={r} host={host} />
                      </span>
                    );
                  })}
                </span>
                <RowMenu row={r} host={host} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/bases/CardsView.tsx web/src/bases/ListView.tsx
git commit -m "feat(web): cards and list layouts" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 15: Kanban layout

**Files:**
- Create: `web/src/bases/KanbanView.tsx`

**Interfaces:**
- Consumes: `LayoutProps` (Task 12), `CellValue`, `RowMenu` (Task 12), `columnAt`, `dragStarted`, `moveChange`, `moveRowInResult`, `propNameOf` (Task 10), `setViewGroupBy` (Task 2), `LayoutProps.newNote` (wired in Task 17).
- Produces: `KanbanView(props: LayoutProps)`.
- Behaviour: columns are the response groups (`groupBy.property` with `groupOrder`), plus an always-present "No value" column last. A card shows the title and the chosen properties. **Drag** (desktop): pointer down on a card (on its title or body, not on another button, link or input; mouse and pen only, so touch scrolls) starts a drag after 6 px, and the click that follows a drag is swallowed; a ghost follows the pointer, the column under it is outlined, Escape cancels, release on a column writes the group property (`moveChange` types the value by the property's registry type: number, checkbox, list, text; "No value" unsets it). **Menu twin**: each card's `...` menu lists "Move to <column>" for every other column, so touch and keyboard users move cards without dragging. A move applies optimistically (`moveRowInResult`) and then writes through `saveProps`. **`+`** in a column header creates a note with that column's value preset (`newNote(preset)`). A board grouped by a computed property (`file.*`, `formula.*`) cannot move cards and says so; a view with no `groupBy` asks for a property and writes it with `setViewGroupBy`.

- [ ] **Step 1: Create the kanban layout**

```tsx
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { PlusIcon } from "@radix-ui/react-icons";
import { setViewGroupBy } from "@brainmd/shared/base-yaml";
import type { PropValue } from "@brainmd/shared/frontmatter";
import { DropdownMenuItem } from "../components/ui/dropdown-menu";
import { CellValue } from "./CellValue";
import { RowMenu } from "./RowMenu";
import { columnAt, dragStarted, moveChange, moveRowInResult, propNameOf } from "./model";
import type { LayoutProps, Row } from "./types";

interface DragState {
  row: Row;
  x: number;
  y: number;
  over: { key: string | null } | undefined;
}

export function KanbanView({ result, view, host, vaultTypes, saveProps, editView, newNote }: LayoutProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const colRefs = useRef(new Map<string | null, HTMLElement>());
  const cleanupRef = useRef<() => void>(() => {});
  useEffect(() => () => cleanupRef.current(), []);

  const groupProp = view.groupBy ? propNameOf(view.groupBy.property) : null;

  if (!view.groupBy) {
    const options = result.columns.filter((c) => propNameOf(c.key) !== null).map((c) => c.key);
    const names = [...new Set([...options, ...vaultTypes.keys()])];
    return (
      <div className="base-empty">
        <p>A board needs a property to group by.</p>
        <select
          className="base-select"
          aria-label="Group by"
          value=""
          onChange={(e) => e.target.value && editView((src, i) => setViewGroupBy(src, i, { property: e.target.value, direction: "ASC" }))}
        >
          <option value="">Choose a property…</option>
          {names.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
    );
  }

  const columns = result.groups.some((g) => g.key === null) ? result.groups : [...result.groups, { key: null, label: "No value", count: 0, rows: [] }];
  const cards = result.columns.filter((c) => c.key !== "file.name");

  const changeFor = (key: string | null) => (groupProp ? moveChange(vaultTypes.get(groupProp), key) : null);

  const moveTo = (row: Row, toKey: string | null) => {
    const ch = changeFor(toKey);
    if (!ch || !groupProp) {
      host.toast("This board is grouped by a computed property, so cards cannot move.");
      return;
    }
    const from = result.groups.find((g) => g.rows.some((r) => r.path === row.path))?.key ?? null;
    if (from === toKey) return;
    void saveProps(row, "set" in ch ? { set: { [groupProp]: ch.set } } : { unset: [groupProp] }, (r) => moveRowInResult(r, row.path, toKey));
  };

  const presetFor = (key: string | null): Record<string, PropValue> => {
    const ch = changeFor(key);
    return ch && groupProp && "set" in ch ? { [groupProp]: ch.set } : {};
  };

  const onCardPointerDown = (e: ReactPointerEvent<HTMLElement>, row: Row) => {
    const target = e.target as HTMLElement;
    if (e.pointerType === "touch" || e.button !== 0 || (target.closest("button, a, input, select") && !target.closest(".base-card-title"))) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let lx = x0;
    let ly = y0;
    let dragging = false;
    const hit = (x: number, y: number) =>
      columnAt(
        [...colRefs.current].map(([key, el]) => {
          const r = el.getBoundingClientRect();
          return { key, left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }),
        x,
        y,
      );
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", key);
      cleanupRef.current = () => {};
    };
    const move = (ev: PointerEvent) => {
      lx = ev.clientX;
      ly = ev.clientY;
      if (!dragging) {
        if (!dragStarted(lx - x0, ly - y0)) return;
        dragging = true;
      }
      setDrag({ row, x: lx, y: ly, over: hit(lx, ly) });
    };
    const up = () => {
      cleanup();
      const target = dragging ? hit(lx, ly) : undefined;
      setDrag(null);
      if (dragging) {
        // The title is a button: without this the release would also open the note.
        const swallow = (ev: MouseEvent) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, true), 50);
      }
      if (target) moveTo(row, target.key);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      cleanup();
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    cleanupRef.current = cleanup;
  };

  return (
    <div className={drag ? "base-board dragging" : "base-board"}>
      {columns.map((g) => (
        <section
          key={g.key ?? "\u0000none"}
          className={drag?.over && drag.over.key === g.key ? "base-col over" : "base-col"}
          ref={(el) => {
            if (el) colRefs.current.set(g.key, el);
            else colRefs.current.delete(g.key);
          }}
          aria-label={`${g.label}, ${g.count} notes`}
        >
          <header className="base-col-head">
            <h4>{g.label}</h4>
            <span className="base-count">{g.count}</span>
            <button type="button" className="btn base-btn icon" aria-label={`Add a note to ${g.label}`} onClick={() => void newNote(presetFor(g.key))}>
              <PlusIcon aria-hidden />
            </button>
          </header>
          <div className="base-col-body">
            {g.rows.map((r) => (
              <article
                key={r.path}
                className={drag?.row.path === r.path ? "base-card lifted" : "base-card"}
                onPointerDown={(e) => onCardPointerDown(e, r)}
              >
                <div className="base-card-head">
                  <button type="button" className="base-link base-card-title" onClick={() => host.openNote(r.path)}>
                    {r.title}
                  </button>
                  <RowMenu row={r} host={host}>
                    {columns
                      .filter((c) => c.key !== g.key)
                      .map((c) => (
                        <DropdownMenuItem key={c.key ?? "\u0000none"} onSelect={() => moveTo(r, c.key)}>
                          Move to {c.label}
                        </DropdownMenuItem>
                      ))}
                  </RowMenu>
                </div>
                <dl className="base-card-props">
                  {cards.map((c) => {
                    const v = r.values[c.key] ?? null;
                    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                    return (
                      <div key={c.key}>
                        <dt>{c.label}</dt>
                        <dd>
                          <CellValue col={c} value={v} row={r} host={host} />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
      {drag ? (
        <div className="base-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }} aria-hidden>
          {drag.row.title}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add web/src/bases/KanbanView.tsx
git commit -m "feat(web): kanban layout with pointer drag and a move menu" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 16: View toolbar: switcher, sort, filter, properties

**Files:**
- Create: `web/src/bases/BaseToolbar.tsx`, `web/src/bases/ToolbarPopovers.tsx`

**Interfaces:**
- Consumes: `BaseQueryResponse` (Task 1), `ViewConfig` (Task 1), `addView`, `deleteView`, `renameView`, `setViewType`, `setViewSort`, `setViewFilters`, `setViewOrder` (Task 2), `effectiveOrder`, `filtersFrom`, `flatFilters`, `moveColumn`, `toggleColumn` (Task 10), `ColumnsIcon` (`web/src/components/Icons.tsx`), `ui/dropdown-menu`, `ui/popover`, Radix icons.
- Produces: `VIEW_TYPES`, `TypeIcon({ type })`, `BaseToolbar({ result, viewIndex, onSwitch(name), editView, tools? })` (view switcher button with type icon, name and result count; menu: views, Add view, View type, Rename, Delete), `interface KeyOption { key; label }`, `SortPopover`, `FilterPopover`, `PropertiesPopover` (each `{ view, options?, editView, open, onOpenChange }`). Every change is an `editView(fn)` call, which Task 17 turns into a fence edit. The three popovers are controlled (`open`, `onOpenChange`) so Task 17 can keep the open one across the remount that every edit causes.
- Behaviour: Sort lists the view's sorts (property select, direction toggle, remove) and adds the first unused property. Filter edits the flat `and` list as one expression per row (Enter or blur commits, a nested tree shows "edit it in the block source"). Properties lists the shown columns with up, down and hide buttons and an "Add property" select; no drag is needed anywhere. Native `<select>` is used on purpose: it is the right picker on a phone.

- [ ] **Step 1: Create the toolbar**

```tsx
import type { ReactNode } from "react";
import { CheckIcon, DashboardIcon, ListBulletIcon, TableIcon, ViewVerticalIcon, ChevronDownIcon } from "@radix-ui/react-icons";
import { addView, deleteView, renameView, setViewType } from "@brainmd/shared/base-yaml";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

export const VIEW_TYPES = ["table", "cards", "list", "kanban"] as const;

export function TypeIcon({ type }: { type: string }) {
  if (type === "cards") return <DashboardIcon aria-hidden />;
  if (type === "list") return <ListBulletIcon aria-hidden />;
  if (type === "kanban") return <ViewVerticalIcon aria-hidden />;
  return <TableIcon aria-hidden />;
}

const cap = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

function freshName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

interface Props {
  result: BaseQueryResponse;
  viewIndex: number;
  onSwitch(name: string): void;
  editView(fn: (source: string, viewIndex: number) => string): void;
  tools?: ReactNode;
}

export function BaseToolbar({ result, viewIndex, onSwitch, editView, tools }: Props) {
  const current = result.views[viewIndex] ?? result.views[0];
  const names = result.views.map((v) => v.name);
  return (
    <div className="base-toolbar">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="btn base-btn base-switch" aria-label={`View: ${current?.name ?? ""}`}>
            <TypeIcon type={current?.type ?? "table"} />
            <span className="base-switch-name">{current?.name ?? "Table"}</span>
            <span className="base-count" aria-label={`${result.total} notes`}>{result.total}</span>
            <ChevronDownIcon aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Views</DropdownMenuLabel>
          {result.views.map((v) => (
            <DropdownMenuItem key={v.name} onSelect={() => onSwitch(v.name)}>
              <TypeIcon type={v.type} />
              <span>{v.name}</span>
              {v.name === result.view ? <CheckIcon className="ml-auto" aria-hidden /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Add view</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {VIEW_TYPES.map((t) => (
                <DropdownMenuItem
                  key={t}
                  onSelect={() => {
                    const name = freshName(cap(t), names);
                    editView((src) => addView(src, { type: t, name }));
                    onSwitch(name);
                  }}
                >
                  <TypeIcon type={t} />
                  <span>{cap(t)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>View type</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {VIEW_TYPES.map((t) => (
                <DropdownMenuItem key={t} onSelect={() => editView((src, i) => setViewType(src, i, t))}>
                  <TypeIcon type={t} />
                  <span>{cap(t)}</span>
                  {current?.type === t ? <CheckIcon className="ml-auto" aria-hidden /> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() => {
              const name = window.prompt("View name", current?.name ?? "")?.trim();
              if (!name || name === current?.name) return;
              editView((src, i) => renameView(src, i, name));
              onSwitch(name);
            }}
          >
            Rename view
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={result.views.length < 2}
            onSelect={() => {
              if (!window.confirm(`Delete the view "${current?.name}"?`)) return;
              const next = result.views.find((_, i) => i !== viewIndex)?.name;
              editView((src, i) => deleteView(src, i));
              if (next) onSwitch(next);
            }}
          >
            Delete view
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="base-tools">{tools}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create the popovers**

```tsx
import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, CaretSortIcon, Cross2Icon, MixerHorizontalIcon, PlusIcon } from "@radix-ui/react-icons";
import type { ViewConfig } from "@brainmd/shared/base-parse";
import type { SortSpec } from "@brainmd/shared/base-types";
import { setViewFilters, setViewOrder, setViewSort } from "@brainmd/shared/base-yaml";
import { ColumnsIcon } from "../components/Icons";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { effectiveOrder, filtersFrom, flatFilters, moveColumn, toggleColumn } from "./model";

type EditView = (fn: (source: string, viewIndex: number) => string) => void;

export interface KeyOption {
  key: string;
  label: string;
}

const labelOf = (options: KeyOption[], key: string): string => options.find((o) => o.key === key)?.label ?? key;

interface OpenProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function SortPopover({ view, options, editView, open, onOpenChange }: { view: ViewConfig; options: KeyOption[]; editView: EditView } & OpenProps) {
  const set = (next: SortSpec[]) => editView((src, i) => setViewSort(src, i, next));
  const unused = options.find((o) => !view.sort.some((s) => s.property === o.key));
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="btn base-btn" aria-label="Sort">
          <CaretSortIcon aria-hidden />
          <span className="base-btn-text">Sort</span>
          {view.sort.length > 0 ? <span className="base-count">{view.sort.length}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="base-pop">
        {view.sort.length === 0 ? <p className="base-hint">No sort. Rows follow file name.</p> : null}
        {view.sort.map((s, i) => (
          <div className="base-pop-row" key={`${s.property}-${i}`}>
            <select
              className="base-select"
              aria-label="Sort property"
              value={s.property}
              onChange={(e) => set(view.sort.map((x, j) => (j === i ? { ...x, property: e.target.value } : x)))}
            >
              {!options.some((o) => o.key === s.property) ? <option value={s.property}>{s.property}</option> : null}
              {options.map((o) => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn base-btn icon"
              aria-label={`Direction ${s.direction === "ASC" ? "ascending" : "descending"}, switch`}
              onClick={() => set(view.sort.map((x, j) => (j === i ? { ...x, direction: x.direction === "ASC" ? "DESC" : "ASC" } : x)))}
            >
              {s.direction === "ASC" ? <ArrowUpIcon aria-hidden /> : <ArrowDownIcon aria-hidden />}
            </button>
            <button type="button" className="btn base-btn icon" aria-label="Remove sort" onClick={() => set(view.sort.filter((_, j) => j !== i))}>
              <Cross2Icon aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn base-btn"
          disabled={!unused}
          onClick={() => unused && set([...view.sort, { property: unused.key, direction: "ASC" }])}
        >
          <PlusIcon aria-hidden /> Add sort
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function FilterPopover({ view, editView, open, onOpenChange }: { view: ViewConfig; editView: EditView } & OpenProps) {
  const flat = flatFilters(view.filters);
  const [draft, setDraft] = useState("");
  const commit = (next: string[]) => editView((src, i) => setViewFilters(src, i, filtersFrom(next)));
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="btn base-btn" aria-label="Filter">
          <MixerHorizontalIcon aria-hidden />
          <span className="base-btn-text">Filter</span>
          {flat === null || flat.length > 0 ? <span className="base-count">{flat === null ? "…" : flat.length}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="base-pop base-pop-wide">
        {flat === null ? (
          <p className="base-hint">This filter uses nested and / or / not groups. Edit it in the block source.</p>
        ) : (
          <>
            <p className="base-hint">All of these must hold. Example: status == "Todo"</p>
            {flat.map((expr, i) => (
              <div className="base-pop-row" key={`${i}:${expr}`}>
                <input
                  className="base-input"
                  aria-label={`Filter ${i + 1}`}
                  defaultValue={expr}
                  spellCheck={false}
                  onBlur={(e) => e.target.value.trim() !== expr && commit(flat.map((x, j) => (j === i ? e.target.value : x)))}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                />
                <button type="button" className="btn base-btn icon" aria-label="Remove filter" onClick={() => commit(flat.filter((_, j) => j !== i))}>
                  <Cross2Icon aria-hidden />
                </button>
              </div>
            ))}
            <div className="base-pop-row">
              <input
                className="base-input"
                aria-label="New filter"
                placeholder='file.hasTag("work")'
                value={draft}
                spellCheck={false}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && draft.trim()) {
                    commit([...flat, draft]);
                    setDraft("");
                  }
                }}
              />
              <button
                type="button"
                className="btn base-btn icon"
                aria-label="Add filter"
                disabled={!draft.trim()}
                onClick={() => {
                  commit([...flat, draft]);
                  setDraft("");
                }}
              >
                <PlusIcon aria-hidden />
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function PropertiesPopover({ view, options, editView, open, onOpenChange }: { view: ViewConfig; options: KeyOption[]; editView: EditView } & OpenProps) {
  const order = effectiveOrder(view.order);
  const set = (next: string[]) => editView((src, i) => setViewOrder(src, i, next));
  const rest = options.filter((o) => !order.includes(o.key));
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button type="button" className="btn base-btn" aria-label="Properties">
          <ColumnsIcon aria-hidden />
          <span className="base-btn-text">Properties</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="base-pop">
        {order.map((key, i) => (
          <div className="base-pop-row" key={key}>
            <span className="base-pop-label">{labelOf(options, key)}</span>
            <button type="button" className="btn base-btn icon" aria-label={`Move ${key} up`} disabled={i === 0} onClick={() => set(moveColumn(view.order, key, -1))}>
              <ArrowUpIcon aria-hidden />
            </button>
            <button type="button" className="btn base-btn icon" aria-label={`Move ${key} down`} disabled={i === order.length - 1} onClick={() => set(moveColumn(view.order, key, 1))}>
              <ArrowDownIcon aria-hidden />
            </button>
            <button type="button" className="btn base-btn icon" aria-label={`Hide ${key}`} disabled={order.length === 1} onClick={() => set(toggleColumn(view.order, key))}>
              <Cross2Icon aria-hidden />
            </button>
          </div>
        ))}
        <select
          className="base-select"
          aria-label="Add property"
          value=""
          onChange={(e) => e.target.value && set(toggleColumn(view.order, e.target.value))}
        >
          <option value="">Add property…</option>
          {rest.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/bases/BaseToolbar.tsx web/src/bases/ToolbarPopovers.tsx
git commit -m "feat(web): view toolbar with switcher, sort, filter and properties" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---


### Task 17: The view shell: live query, write-back, hydration in Preview, styles

**Files:**
- Create: `web/src/bases/BaseView.tsx`, `web/src/styles/bases.css`
- Modify: `web/src/components/Preview.tsx`, `web/src/App.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1 to 16; Phase 1's `editContent` and `setToast` in `App.tsx`, `setProperties` (`@brainmd/shared/frontmatter`), `api.properties()`.
- Produces: `BaseView({ source, startLine, ordinal, notePath, host })`; `Preview` prop `baseHost?: BaseHost`; in `App`, `baseHost` (stable via a ref) and `emitBaseRefresh()` after each successful autosave.
- Behaviour of `BaseView`:
  - Queries `POST /api/bases/query` (limit 2000, debounced 200 ms, stale responses aborted) on mount, when the YAML, the note or the chosen view changes, on window focus, and on `emitBaseRefresh()`. A fresh mount paints the last result for its block from `store.ts` at once (and skips the fetch when the fingerprint is unchanged), so the view never falls back to "Loading" when `Preview` swaps its HTML on a keystroke or a toolbar edit. The open toolbar popover is kept in the store too and reopens after the edit it made.
  - The toolbar lists the views and shows the count; warnings show as one quiet line (first three, then "+N more").
  - `editView(fn)` rewrites the fence body with `host.editFence`, which is one CodeMirror transaction when the editor is mounted (so undo, autosave, the status chip and `base_revision` work) and the `content` state otherwise. A view-less source gets a `Table` view added first. A `BaseYamlError` (inline style, invalid YAML) becomes a toast that tells the user to edit the source; nothing is written.
  - `saveProps(row, change, optimistic?)`: optional optimistic local patch; then, if the row is the note open in the editor, `host.edit((text) => setProperties(...))`; otherwise `PATCH /api/note-properties/*` with the row's `revision`. A 409 shows "changed meanwhile, refreshed" and re-queries; any failure re-queries too.
  - `+ New` runs `planNewNote` over the global and view filters, then `host.createNote` (create-only write, refreshes the tree, opens the note for editing); on a name clash it tries the next free name, up to five times.
- Preview behaviour: the placeholders are replaced whenever Preview's HTML changes, which discards the React roots, so Preview mounts a root per `.base-block[data-base]` in an effect on `[html, notePath, baseHost]` and unmounts them in a microtask in the cleanup. Its click handler must ignore clicks inside `.base-view`, or it would cancel checkboxes, hijack links and jump the editor cursor.

- [ ] **Step 1: Create the shell**

`web/src/bases/BaseView.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { parseBase, type ViewConfig } from "@brainmd/shared/base-parse";
import { MAX_QUERY_LIMIT, type BaseQueryResponse } from "@brainmd/shared/base-types";
import { PlusIcon } from "@radix-ui/react-icons";
import { BaseYamlError, addView } from "@brainmd/shared/base-yaml";
import { setProperties, type PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { ConflictError, api } from "../api/client";
import { BaseToolbar } from "./BaseToolbar";
import { CardsView } from "./CardsView";
import { KanbanView } from "./KanbanView";
import { ListView } from "./ListView";
import { TableView } from "./TableView";
import type { BaseHost } from "./host";
import { candidateKeys } from "./model";
import { buildNoteContent, planNewNote, uniqueNotePath } from "./new-note";
import { FilterPopover, PropertiesPopover, SortPopover, type KeyOption } from "./ToolbarPopovers";
import { blockKey, emitBaseRefresh, getActiveView, getCached, getLast, getOpenTool, onBaseRefresh, setActiveView, setCached, setOpenTool } from "./store";
import type { LayoutProps, PropChange, Row } from "./types";

export interface BaseViewProps {
  source: string;
  startLine: number;
  ordinal: number;
  notePath: string | null;
  host: BaseHost;
}

let typesCache: { at: number; value: Promise<Map<string, PropertyType>> } | null = null;
function loadVaultTypes(): Promise<Map<string, PropertyType>> {
  if (!typesCache || Date.now() - typesCache.at > 30_000) {
    typesCache = {
      at: Date.now(),
      value: api
        .properties()
        .then((list) => new Map(list.map((p) => [p.name, p.type] as [string, PropertyType])))
        .catch(() => new Map<string, PropertyType>()),
    };
  }
  return typesCache.value;
}

const DEFAULT_VIEW: ViewConfig = { type: "table", name: "Table", order: [], sort: [], groupOrder: [], columnSize: {}, summaries: {} };

export function BaseView({ source, startLine, ordinal, notePath, host }: BaseViewProps) {
  const key = blockKey(notePath, ordinal);
  const parsed = useMemo(() => parseBase(source), [source]);
  const [activeName, setActiveName] = useState<string | undefined>(() => getActiveView(key));
  const fingerprint = `${source}\u0000${notePath ?? ""}\u0000${activeName ?? ""}`;
  const [result, setResult] = useState<BaseQueryResponse | null>(() => getCached(key, fingerprint) ?? getLast(key) ?? null);
  const [openTool, setOpenToolState] = useState<string | null>(() => getOpenTool(key));
  const toolOpen = (name: string) => ({
    open: openTool === name,
    onOpenChange: (o: boolean) => {
      const next = o ? name : null;
      setOpenToolState(next);
      setOpenTool(key, next);
    },
  });
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [vaultTypes, setVaultTypes] = useState<Map<string, PropertyType>>(new Map());

  useEffect(() => onBaseRefresh(() => setTick((t) => t + 1)), []);
  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    let live = true;
    void loadVaultTypes().then((m) => live && setVaultTypes(m));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (tick === 0) {
      const hit = getCached(key, fingerprint);
      if (hit) {
        setResult(hit);
        return;
      }
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      api
        .baseQuery({ source, view: activeName, thisPath: notePath ?? undefined, limit: MAX_QUERY_LIMIT }, ctl.signal)
        .then((r) => {
          setCached(key, fingerprint, r);
          setResult(r);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [key, fingerprint, tick, source, activeName, notePath]);

  const views = parsed.config.views;
  const viewIndex = Math.max(0, views.findIndex((v) => v.name === result?.view));
  const view = views[viewIndex] ?? DEFAULT_VIEW;

  const editView = useCallback(
    (fn: (src: string, idx: number) => string) => {
      try {
        const ok = host.editFence(startLine, (src) => {
          const withView = parseBase(src).config.views.length > 0 ? src : addView(src, { type: "table", name: "Table" });
          return fn(withView, viewIndex);
        });
        if (!ok) host.toast("Could not find this block in the note");
      } catch (e) {
        host.toast(e instanceof BaseYamlError ? `Edit the block in the source: ${e.message}` : `Edit failed: ${String(e)}`);
      }
    },
    [host, startLine, viewIndex],
  );

  const saveProps = useCallback(
    async (row: Row, change: PropChange, optimistic?: (r: BaseQueryResponse) => BaseQueryResponse): Promise<boolean> => {
      if (optimistic) setResult((r) => (r ? optimistic(r) : r));
      if (row.path === host.currentPath()) {
        try {
          host.edit((text) => setProperties(text, change.set ?? {}, change.unset));
          return true;
        } catch (e) {
          host.toast(`Property edit refused: ${e instanceof Error ? e.message : String(e)}`);
          setTick((t) => t + 1);
          return false;
        }
      }
      try {
        await api.patchNoteProperties(row.path, { set: change.set, unset: change.unset, baseRevision: row.revision });
        emitBaseRefresh();
        return true;
      } catch (e) {
        host.toast(e instanceof ConflictError ? `${row.title} changed meanwhile, refreshed` : `Save failed: ${e instanceof Error ? e.message : String(e)}`);
        emitBaseRefresh();
        return false;
      }
    },
    [host],
  );

  const newNote = useCallback(
    async (preset?: Record<string, PropValue>): Promise<void> => {
      const plan = planNewNote([parsed.config.filters, view.filters], preset);
      const tried = new Set<string>();
      for (let attempt = 0; attempt < 5; attempt++) {
        const path = uniqueNotePath(plan.folder, (p) => host.noteExists(p) || tried.has(p));
        const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
        if ((await host.createNote(path, buildNoteContent(title, plan.props))) !== "exists") return;
        tried.add(path);
      }
      host.toast("Could not find a free note name");
    },
    [host, parsed.config.filters, view.filters],
  );

  if (!result) {
    return (
      <div className="base-view" aria-busy={!error}>
        {error ? <p className="base-warn">Could not run this view: {error}</p> : <p className="base-empty">Loading view</p>}
      </div>
    );
  }

  const options: KeyOption[] = candidateKeys(
    [...vaultTypes.keys()],
    Object.keys(parsed.config.formulas),
    result.columns.map((c) => c.key),
  ).map((key) => ({ key, label: result.columns.find((c) => c.key === key)?.label ?? key.replace(/^(file|note)\./, "") }));
  const layout: LayoutProps = { result, config: parsed.config, view, vaultTypes, host, saveProps, editView, newNote };
  const type = result.views[viewIndex]?.type ?? "table";
  const warnings = result.warnings;

  return (
    <div className="base-view">
      <BaseToolbar
        result={result}
        viewIndex={viewIndex}
        onSwitch={(name) => {
          setActiveView(key, name);
          setActiveName(name);
        }}
        editView={editView}
        tools={
          <>
            <SortPopover view={view} options={options} editView={editView} {...toolOpen("sort")} />
            <FilterPopover view={view} editView={editView} {...toolOpen("filter")} />
            <PropertiesPopover view={view} options={options} editView={editView} {...toolOpen("properties")} />
            <button type="button" className="btn base-btn" aria-label="New note" onClick={() => void newNote()}>
              <PlusIcon aria-hidden />
              <span className="base-btn-text">New</span>
            </button>
          </>
        }
      />
      {error ? <p className="base-warn">Could not refresh: {error}</p> : null}
      {warnings.length > 0 ? (
        <p className="base-warn">
          {warnings.slice(0, 3).join(" · ")}
          {warnings.length > 3 ? ` · +${warnings.length - 3} more` : ""}
        </p>
      ) : null}
      {result.groups.every((g) => g.rows.length === 0) && type !== "kanban" ? (
        <p className="base-empty">No notes match this view.</p>
      ) : type === "table" ? (
        <TableView {...layout} />
      ) : type === "cards" ? (
        <CardsView {...layout} />
      ) : type === "list" ? (
        <ListView {...layout} />
      ) : type === "kanban" ? (
        <KanbanView {...layout} />
      ) : (
        <p className="base-empty">The {type} layout is not supported yet. The view keeps its settings.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create the styles**

`web/src/styles/bases.css`. Rules inside the note carry the `.preview .doc` prefix so they beat the preview's own table, list and link rules; popovers and menus render in a portal outside `.preview .doc`, so their rules are global. Tokens only.

```css
/* Views from ```base blocks. Tokens only; no new colours. */

/* Popovers and menus render in a portal, outside .preview .doc. */
.btn.base-btn {
  min-height: 28px;
  padding: 4px 8px;
  gap: 6px;
  font-size: var(--text-sm);
}
.btn.base-btn.icon {
  min-width: 28px;
  padding: 4px;
}
.base-count {
  color: var(--text-3);
  font-size: var(--text-xs);
  font-variant-numeric: tabular-nums;
}
.base-pop {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  width: 320px;
  max-width: calc(100vw - 32px);
}
.base-pop-wide {
  width: 420px;
}
.base-pop-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.base-pop-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-sm);
}
.base-hint {
  margin: 0;
  color: var(--text-3);
  font-size: var(--text-xs);
}
.base-input,
.base-select {
  flex: 1;
  min-width: 0;
  min-height: 28px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius-1);
  background: var(--bg-surface);
  color: var(--text-1);
  font: inherit;
  font-size: var(--text-sm);
}
.base-input:focus-visible,
.base-select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 0;
}
.base-cell-input {
  width: 100%;
}
@media (pointer: coarse) {
  .btn.base-btn {
    min-height: 40px;
  }
  .btn.base-btn.icon {
    min-width: 40px;
  }
  .base-input,
  .base-select {
    min-height: 40px;
  }
}

/* Inside the note. The longer selector beats the preview table, list and link rules. */
.preview .doc .base-block {
  margin: var(--space-4) 0;
  max-width: 100%;
}
.preview .doc .base-view {
  border: 1px solid var(--border);
  border-radius: var(--radius-2);
  background: var(--bg-surface);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  line-height: var(--line-tight);
  color: var(--text-1);
  overflow-wrap: normal;
  word-break: normal;
}
.preview .doc .base-view button {
  font: inherit;
}
.preview .doc .base-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--border);
}
.preview .doc .base-tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-left: auto;
}
.preview .doc .base-switch-name {
  font-weight: 500;
  color: var(--text-1);
}
.preview .doc .base-warn,
.preview .doc .base-empty {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  color: var(--text-3);
  font-size: var(--text-xs);
}
.preview .doc .base-empty {
  font-size: var(--text-sm);
}
.preview .doc .base-link {
  display: inline;
  padding: 0;
  border: 0;
  background: none;
  color: var(--link);
  text-align: left;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.preview .doc .base-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
}
.preview .doc .base-chip {
  padding: 0 6px;
  border-radius: var(--radius-1);
  background: var(--tag-bg);
  color: var(--tag-fg);
}

.preview .doc .base-table-wrap {
  overflow: auto;
  max-height: min(70vh, 640px);
}
.preview .doc .base-table {
  width: 100%;
  min-width: max-content;
  margin: 0;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
}
.preview .doc .base-table th,
.preview .doc .base-table td {
  border: 0;
  border-bottom: 1px solid var(--border);
  padding: 4px 8px;
  text-align: left;
  vertical-align: middle;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview .doc .base-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0;
  background: var(--bg-surface-2);
  color: var(--text-2);
  font-weight: 500;
}
.preview .doc .base-table tfoot td {
  position: sticky;
  bottom: 0;
  background: var(--bg-surface-2);
  color: var(--text-2);
  border-top: 1px solid var(--border);
  border-bottom: 0;
}
.preview .doc .base-col-menu {
  width: 44px;
}
.preview .doc .base-th-btn {
  display: block;
  width: 100%;
  padding: 6px 12px 6px 8px;
  border: 0;
  background: none;
  color: inherit;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.preview .doc .base-th-btn:hover {
  background: var(--bg-hover);
}
.preview .doc .base-resize {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
}
.preview .doc .base-resize:hover,
.preview .doc .base-resize:focus-visible {
  background: var(--accent-soft);
  outline: none;
}
.preview .doc .base-group td {
  background: var(--bg-surface-2);
  font-weight: 500;
}
.preview .doc .base-td-menu {
  text-align: right;
}
.preview .doc .base-cell-edit {
  min-height: 20px;
  border-radius: var(--radius-1);
  cursor: text;
}
.preview .doc .base-cell-edit:hover {
  background: var(--bg-hover);
}
.preview .doc .base-cell-edit:focus-visible,
.preview .doc .base-check:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.preview .doc .base-check {
  accent-color: var(--accent);
}
.preview .doc .base-check-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  min-height: 20px;
}

.preview .doc .base-group-title {
  margin: 0;
  padding: var(--space-2) var(--space-3) 0;
  font-size: var(--text-sm);
  color: var(--text-2);
}
.preview .doc .base-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
  padding: var(--space-3);
}
.preview .doc .base-card {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-2);
  background: var(--bg-surface);
}
.preview .doc .base-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-2);
}
.preview .doc .base-card-title {
  font-weight: 500;
}
.preview .doc .base-card-props {
  margin: var(--space-1) 0 0;
}
.preview .doc .base-card-props div {
  display: flex;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-2);
}
.preview .doc .base-card-props dt {
  flex: 0 0 auto;
  color: var(--text-3);
}
.preview .doc .base-card-props dd {
  margin: 0;
  min-width: 0;
}
.preview .doc .base-cover {
  margin: calc(var(--space-2) * -1) calc(var(--space-3) * -1) var(--space-2);
}
.preview .doc .base-cover img,
.preview .doc .base-cover-ph {
  display: block;
  width: 100%;
  margin: 0;
  aspect-ratio: 16 / 9;
  object-fit: cover;
  border-radius: var(--radius-2) var(--radius-2) 0 0;
  background: var(--bg-surface-2);
}

.preview .doc .base-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.preview .doc .base-list li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  padding: 2px var(--space-3);
  border-bottom: 1px solid var(--border);
}
.preview .doc .base-list-meta {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  gap: var(--space-3);
  min-width: 0;
  color: var(--text-3);
  font-size: var(--text-xs);
}

.preview .doc .base-board {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-3);
  overflow-x: auto;
}
.preview .doc .base-col {
  flex: 0 0 min(260px, 85vw);
  border-radius: var(--radius-2);
  background: var(--bg-surface-2);
}
.preview .doc .base-col.over {
  outline: 2px solid var(--accent);
}
.preview .doc .base-col-head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
}
.preview .doc .base-col-head h4 {
  flex: 1;
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 500;
}
.preview .doc .base-col-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 40px;
  padding: 0 var(--space-2) var(--space-2);
}
.preview .doc .base-card.lifted {
  opacity: 0.4;
}
.preview .doc .base-board.dragging {
  cursor: grabbing;
  user-select: none;
}
.preview .doc .base-ghost {
  position: fixed;
  z-index: var(--z-modal);
  max-width: 240px;
  padding: 4px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-2);
  background: var(--bg-elev);
  box-shadow: var(--shadow-2);
  pointer-events: none;
}
@media (hover: hover) and (pointer: fine) {
  .preview .doc .base-board .base-card {
    cursor: grab;
  }
}
@media (pointer: coarse) {
  .preview .doc .base-th-btn,
  .preview .doc .base-cell-edit,
  .preview .doc .base-link {
    min-height: 40px;
    display: inline-flex;
    align-items: center;
  }
  .preview .doc .base-th-btn {
    display: flex;
  }
  .preview .doc .base-resize {
    width: 20px;
  }
  .preview .doc .base-check-wrap {
    min-width: 40px;
    min-height: 40px;
  }
  .preview .doc .base-check {
    width: 22px;
    height: 22px;
  }
}
```

- [ ] **Step 3: Mount the views in `Preview.tsx`**

Add to the imports at the top (Phase 1 already changed the first line to import `ReactNode`):

```tsx
import { createRoot } from "react-dom/client";
import { BaseView } from "../bases/BaseView";
import type { BaseHost } from "../bases/host";
```

Add the prop to `PreviewProps` and to the destructured parameters of `Preview`:

```tsx
  baseHost?: BaseHost;
```

```tsx
  { content, notePath, resolveByBasename, onOpenNote, onMissingNote, onOpenTag, onScrollLine, onSelectLine, baseHost },
```

(keep whatever other props Phase 1 added, such as `header`, in that list).

In the click handler effect (`const handler = (e: MouseEvent) => {`), make the first line of the handler:

```tsx
      if ((e.target as HTMLElement | null)?.closest?.(".base-view")) return;
```

Add this effect after the mermaid effect and before the `return (` of the component:

```tsx
  // ```base blocks: mount a live view into each placeholder. Preview replaces
  // its HTML on every change, which discards the placeholders, so the roots
  // are rebuilt with it; what the user picked lives in bases/store.ts.
  useEffect(() => {
    const root = ref.current;
    if (!root || !baseHost) return;
    const hosts = Array.from(root.querySelectorAll<HTMLElement>(".base-block[data-base]"));
    if (hosts.length === 0) return;
    const roots = hosts.map((el, ordinal) => {
      const r = createRoot(el);
      r.render(
        <BaseView
          source={el.getAttribute("data-base") ?? ""}
          startLine={Number(el.getAttribute("data-source-line"))}
          ordinal={ordinal}
          notePath={notePath}
          host={baseHost}
        />,
      );
      return r;
    });
    return () => {
      queueMicrotask(() => {
        for (const r of roots) r.unmount();
      });
    };
  }, [html, notePath, baseHost]);
```

- [ ] **Step 4: Build the host in `App.tsx` and refresh views after a save**

Imports, after `import { isMediaName } from "./renderer/render";`:

```tsx
import type { BaseHost } from "./bases/host";
import { applyEdit as applyTextEdit, fenceEdit } from "./bases/edit";
import { emitBaseRefresh } from "./bases/store";
```

After the last `import "./styles/...";` line (Phase 1 put `properties.css` after `changes.css`):

```tsx
import "./styles/bases.css";
```

In `onSave`, right after `noteRevisionRef.current = result.revision;`:

```tsx
        emitBaseRefresh();
```

Add the host after `createNote` and before the `// [[link]] to a note that doesn't exist: ask, then create it.` comment. It needs `editContent` (Phase 1), `openNote`, `refreshTree`, `resolveWikilink`, `tree`, `path`, `setToast`, `api` and `ConflictError`, all defined above that point:

```tsx
  // What ```base views in the preview need from the app. The ref keeps the
  // host stable, so Preview mounts views without re-rendering them, while it
  // still reads the latest path, tree and callbacks.
  const baseLatest = useRef({ path, tree, openNote, resolveWikilink, refreshTree });
  baseLatest.current = { path, tree, openNote, resolveWikilink, refreshTree };
  const baseHost = useMemo<BaseHost>(
    () => ({
      currentPath: () => baseLatest.current.path,
      edit: editContent,
      editFence: (startLine, mutate) => {
        let found = false;
        editContent((text) => {
          const edit = fenceEdit(text, startLine, mutate);
          if (!edit) return text;
          found = true;
          return applyTextEdit(text, edit);
        });
        return found;
      },
      openNote: (p) => void baseLatest.current.openNote(p),
      openLink: (target, from) => {
        const p = baseLatest.current.resolveWikilink(target, from);
        if (p) void baseLatest.current.openNote(p);
        else setToast(`No note named ${target}`);
      },
      noteExists: (p) => baseLatest.current.tree.notes.includes(p) || (baseLatest.current.tree.hiddenNotes ?? []).includes(p),
      createNote: async (p, c) => {
        try {
          await api.writeNote(p, c, undefined, { createOnly: true });
        } catch (e) {
          if (e instanceof ConflictError) return "exists";
          setToast(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
          return "failed";
        }
        await baseLatest.current.refreshTree();
        await baseLatest.current.openNote(p, { edit: true });
        return "created";
      },
      toast: (m) => setToast(m),
    }),
    [editContent],
  );
```

Pass it to `<Preview ... />` (next to `onSelectLine`):

```tsx
            baseHost={baseHost}
```

- [ ] **Step 5: Typecheck, lint, build and run the web tests**

Run: `bun run typecheck && bun run lint && bun run --cwd web build && cd web && bun test`
Expected: all clean and passing. If `tsc` says `editContent` is not found, Phase 1's Task 10 has not landed; stop and fix the order.

- [ ] **Step 6: Commit**

```bash
git add web/src/bases/BaseView.tsx web/src/styles/bases.css web/src/components/Preview.tsx web/src/App.tsx
git commit -m "feat(web): live base views in the preview with write-back to the fence" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 18: Docs and changelog

**Files:**
- Create: `docs/views.md`
- Modify: `README.md`, `CHANGELOG.md`

**Interfaces:**
- Consumes: the behaviour built in Tasks 1 to 17.
- Produces: user docs for the fence format, the supported subset and the safety rules; a README feature row; a changelog entry. (The tool count and tables for `query_notes` were done in Task 8.)

- [ ] **Step 1: Write `docs/views.md`**

`````markdown
# Views

A fenced `base` block in any note is a live view over your notes, in the same YAML format Obsidian Bases uses.

````base
filters:
  and:
    - file.inFolder("Projects")
views:
  - type: table
    name: Table
    order:
      - file.name
      - status
      - due
    sort:
      - property: due
        direction: ASC
  - type: kanban
    name: Board
    groupBy:
      property: status
    groupOrder: [Todo, Doing, Done]
````

The view shows in the preview. The toolbar switches views and edits sort, filters and columns; each change is written back into the block, so the view definition is an ordinary change to the note (it shows in History and the Changes view). Keys brain.md does not understand are left as they are.

## What a view lists

Every note (`.md`) the viewer may read, except hidden notes and the note that holds the block. Obsidian lists every file; brain.md lists notes only.

## Layouts

`table`, `cards`, `list`, `kanban`. `map` keeps its settings and shows "not supported yet".

- **Table**: click a cell to edit that property; drag a header edge, or use the column menu, to resize; the column menu also sorts, moves, hides and sets a summary. Widths are saved as `columnSize`.
- **Cards**: title, the chosen properties and an optional cover from the view's `image` property (a note property holding an image link or URL).
- **List**: one compact row per note.
- **Kanban**: columns come from `groupBy` and `groupOrder`. Drag a card to another column to set that property, or use the `...` menu, "Move to <column>". `+` in a column creates a note with the property preset.

## View keys

`type`, `name`, `order` (columns), `filters`, `sort`, `groupBy` (`property`, `direction`), `groupOrder`, `limit`, `summaries`, `columnSize`, `image`. Top level: `filters`, `formulas`, `properties` (`displayName`), `summaries`, `views`.

A column or sort key is `file.<name>`, `formula.<name>`, `note.<name>` or a bare property name.

## Expressions

Filters and formulas are one expression: property names, `note.x`, `note["a b"]`, `file.x`, `formula.x`, `this.x`, literals, `! && || == != < <= > >= + - * / %`, parentheses.

`file.` values: `name`, `basename`, `fullname`, `path`, `folder`, `ext`, `size`, `ctime`, `mtime`, `tags`, `links`, `backlinks`, `embeds`, `properties`.

Functions: `file.hasTag`, `file.inFolder`, `file.hasLink`, `file.hasProperty`; on text `contains containsAll containsAny startsWith endsWith isEmpty lower upper trim`; on lists `contains containsAll containsAny isEmpty length`; on anything `isTruthy toString`; `if`, `now`, `today`, `date`, `link`; on dates `format` (`YYYY MM DD HH mm`) and `+` / `-` with `"1 week"`, `"3d"`.

Anything else (an unknown function, a lambda, `?:`) evaluates to empty and the view shows a quiet warning naming it. It never blanks the view and never fails the note. A filter that cannot be read at all is ignored, with a warning.

Expressions come from notes and from agents, so they are sandboxed: they read own properties only, call methods from a fixed table, have a step budget, and cannot build regular expressions.

## Permissions

A view only shows notes the viewer may read, including in link cells (`file.links`, `file.backlinks`, link properties).

## Agents

`query_notes` runs the same engine: `filter`, `columns` and `sort`, or a `base` YAML, or `path` and `view` to run a block in a note. See [MCP](mcp.md).
`````

- [ ] **Step 2: README and CHANGELOG**

In `README.md`, add a row to the "What you get" table after the "Live editor + preview" row:

```markdown
| **Views over your notes** | A `base` block in any note is a live table, cards, list or kanban over your notes, in Obsidian Bases format: filters, sort, groups, formulas. Edit a cell or drag a card and the note's frontmatter changes. Agents run the same query with `query_notes`. [Views](docs/views.md). |
```

In `CHANGELOG.md`, add under `# Changelog`, above the newest release (match Phase 1's `Unreleased` section if it exists; otherwise create it):

```markdown
## Unreleased

### Added

- **Views.** A fenced `base` block in a note renders as a live table, cards, list or kanban over the vault's notes, in the Obsidian Bases format. The toolbar edits sort, filters, columns, view type and column width and writes them back into the block. Table cells edit properties in place; kanban cards move between columns by drag or by a menu; `+` creates a note with the filter's folder and properties. Expressions run in a sandbox with a step budget; unsupported syntax gives a warning, never an error. See `docs/views.md`.
- **`query_notes` (MCP) and `POST /api/bases/query`.** The same query for agents and the UI: a `filter` expression with `columns` and `sort`, a `base` YAML, or a note's block by `path` and `view`. 50 rows per page. MCP now has 20 tools.
- The note index stores each note's revision (snapshot version 4); it is rebuilt once at startup.
```

- [ ] **Step 3: Check the links and commit**

Run: `grep -n "views.md" README.md CHANGELOG.md docs/views.md`
Expected: the README row and the changelog mention it.

```bash
git add docs/views.md README.md CHANGELOG.md
git commit -m "docs: views" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---


### Task 19: Final verification: build, tests and a screenshot run

**Files:**
- No repo changes. A throwaway script and scratch vault live in `$TMPDIR/brainmd-views-e2e` (outside the repo).

**Interfaces:**
- Consumes: the running dev stack (web `:5173`, server `:3000`).
- Produces: pass/fail output and screenshots `01-table.png`, `02-cards.png`, `03-kanban.png`, `04-mobile-board.png` in the scratch folder.
- Also checks typing speed: open the host note with a view over 500 notes, type 30 characters in the editor, and confirm in the network log that `/api/bases/query` is not called per keystroke and the input does not lag. If it is, debounce re-queries on content change and keep the view roots mounted when the fence text did not change.

- [ ] **Step 1: Run the full automated checks**

```bash
bun run typecheck
bun run lint
bun test
cd web && bun test && cd ..
bun run --cwd web build
git diff main...HEAD | grep -nP "\x{2014}" || echo "no em dashes"
```

Expected: typecheck and lint clean, every test passes, the web build succeeds, and the last command prints `no em dashes`. Fix anything that fails before the screenshot run; a screenshot of a broken build proves nothing.

- [ ] **Step 2: Prepare a scratch vault and start the dev stack**

````bash
export E2E="${TMPDIR:-/tmp}/brainmd-views-e2e"
mkdir -p "$E2E/vault/Projects" && cd "$E2E"
printf -- '---\nstatus: Todo\nn: 3\ndue: 2026-12-01\ntags: [a]\n---\n# Alpha\n' > vault/Projects/Alpha.md
printf -- '---\nstatus: Doing\nn: 1\n---\n# Beta\n' > vault/Projects/Beta.md
printf -- '---\nstatus: Done\nn: 7\n---\n# Gamma\n' > vault/Projects/Gamma.md
printf -- '---\nn: 5\n---\n# Delta\n' > vault/Projects/Delta.md
printf -- '---\nhidden: true\nstatus: Todo\nn: 9\n---\n# Hidden\n' > vault/Projects/Hidden.md
cat > vault/Board.md <<'EOT'
# Board

```base
filters:
  and:
    - file.inFolder("Projects")
views:
  - type: table
    name: Table
    order:
      - file.name
      - status
      - n
      - due
      - tags
    sort:
      - property: n
        direction: ASC
    summaries:
      n: Sum
  - type: cards
    name: Cards
    order: [file.name, status]
  - type: list
    name: List
    order: [file.name, status]
  - type: kanban
    name: Board
    order: [file.name, n]
    groupBy:
      property: status
    groupOrder: [Todo, Doing, Done]
```

```yaml
not: a view
```
EOT
(cd <repo-root> && VAULT_DIR="$E2E/vault" bun run dev > "$E2E/dev.log" 2>&1 &)
until curl -sf http://localhost:5173 > /dev/null; do sleep 1; done
bun init -y > /dev/null && bun add playwright && bunx playwright install chromium
````

Replace `<repo-root>` with the worktree path. The vault has five notes under `Projects` (one hidden) and a board note at the root. `bun add` runs in the scratch folder, never in the repo.

- [ ] **Step 3: Write the script**

`$E2E/e2e.mjs`:

```js
import { chromium, devices } from "playwright";
import { readFile, readdir } from "node:fs/promises";

const base = "http://localhost:5173";
const out = process.env.E2E;
const vault = `${out}/vault`;
const fail = (m) => { console.error("FAIL", m); process.exitCode = 1; };
const eq = (got, want, m) => (got === want ? console.log("ok", m) : fail(`${m}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`));
const text = (p) => readFile(`${vault}/${p}`, "utf8");
async function until(fn, ms = 6000) {
  const t = Date.now();
  for (;;) {
    if (await fn().catch(() => false)) return true;
    if (Date.now() - t > ms) return false;
    await new Promise((r) => setTimeout(r, 120));
  }
}
const fileHas = (p, s) => until(async () => (await text(p)).includes(s));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => fail(`page error: ${e.message}`));
await page.goto(`${base}/#/note/Board.md`);
await page.waitForSelector(".preview .base-view .base-table");

eq(await page.locator(".base-table tbody tr").count(), 4, "table lists the four visible notes, hidden one left out");
eq(await page.locator(".base-table tbody tr:first-child td:first-child").innerText(), "Beta", "sorted by n ascending");
eq(await page.locator(".base-table tfoot td").nth(2).innerText(), "Sum 16", "summary row sums n");
eq(await page.locator(".preview .doc pre code").count() > 0, true, "the plain yaml fence is still a code block");
await page.screenshot({ path: `${out}/01-table.png` });

// cell edit on a note that is not open: PATCH path
await page.locator(".base-table tbody tr", { hasText: "Alpha" }).locator("td").nth(1).locator(".base-cell-edit").click();
await page.locator(".base-cell-input").fill("Doing");
await page.keyboard.press("Enter");
eq(await fileHas("Projects/Alpha.md", "status: Doing"), true, "cell edit wrote the property (PATCH)");
eq(await fileHas("Projects/Alpha.md", "tags: [a]"), true, "the rest of Alpha's frontmatter is untouched");

// column resize by keyboard writes columnSize into the fence; the view stays on screen
await page.locator(".base-resize").nth(1).focus();
await page.keyboard.press("ArrowRight");
await page.keyboard.press("ArrowRight");
await page.keyboard.press("Enter");
eq(await fileHas("Board.md", "status: 180"), true, "resize wrote columnSize into the block");
eq(await page.locator(".base-table").count(), 1, "the table is still there after the block was rewritten");

// filter edit through the toolbar
await page.getByRole("button", { name: "Filter" }).click();
await page.getByLabel("New filter").fill('status != "Done"');
await page.keyboard.press("Enter");
eq(await fileHas("Board.md", 'status != "Done"'), true, "filter written into the block");
await page.waitForSelector('.base-pop [aria-label="Filter 1"]');
console.log("ok the Filter popover is still open after its own edit");
await page.keyboard.press("Escape");
await page.waitForFunction(() => document.querySelectorAll(".base-table tbody tr").length === 3);
console.log("ok filter re-queried the view: 3 rows");
eq(await text("Board.md").then((t) => t.includes("```yaml\nnot: a view\n```")), true, "the rest of the note is untouched");

// switch layouts; the choice survives the re-render that follows an edit
await page.locator(".base-switch").click();
await page.getByRole("menuitem", { name: /Cards/ }).click();
await page.waitForSelector(".base-cards");
await page.screenshot({ path: `${out}/02-cards.png` });
await page.locator(".base-switch").click();
await page.getByRole("menuitem", { name: /^List/ }).click();
await page.waitForSelector(".base-list");
await page.locator(".base-switch").click();
await page.getByRole("menuitem", { name: /Board/ }).click();
await page.waitForSelector(".base-board");
eq(await page.locator(".base-col").count(), 4, "kanban: Todo, Doing, Done and No value");
await page.screenshot({ path: `${out}/03-kanban.png` });

// drag Beta (Doing) to Done with the mouse
const card = page.locator(".base-card", { hasText: "Beta" });
const from = await card.boundingBox();
const to = await page.locator('.base-col[aria-label^="Done"]').boundingBox();
await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
await page.mouse.down();
await page.mouse.move(to.x + 40, to.y + 90, { steps: 12 });
await page.mouse.up();
eq(await fileHas("Projects/Beta.md", "status: Done"), true, "drag wrote the group property");
eq(await page.locator(".cm-content").first().innerText().then((t) => t.includes("# Board")), true, "the drag did not open the note");

// the menu twin: Gamma to Todo
await page.locator(".base-card", { hasText: "Gamma" }).getByRole("button", { name: /Actions for/ }).click();
await page.getByRole("menuitem", { name: "Move to Todo" }).click();
eq(await fileHas("Projects/Gamma.md", "status: Todo"), true, "menu move wrote the group property");

// + in a column creates a note with the property preset, in the filter's folder, and opens it
await page.getByRole("button", { name: "Add a note to Doing" }).click();
await page.waitForSelector(".cm-content");
const created = (await readdir(`${vault}/Projects`)).find((f) => f.startsWith("Untitled"));
eq(Boolean(created), true, "a new note was created in Projects");
eq(await fileHas(`Projects/${created}`, "status: Doing"), true, "with the column's status");

// phone: touch targets, no sideways page scroll, menu twin reachable
const phone = await browser.newContext({ ...devices["iPhone 13"] });
const m = await phone.newPage();
await m.goto(`${base}/#/note/Board.md`);
await m.waitForSelector(".base-view");
await m.screenshot({ path: `${out}/04-mobile-board.png` });
const small = await m.evaluate(() =>
  [...document.querySelectorAll(".base-view .btn, .base-view .base-link, .base-view .base-th-btn")].filter((e) => e.getBoundingClientRect().height < 39.5).length,
);
eq(small, 0, "every button and link in the view is at least 40px tall on a phone");
eq(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways page scroll on a phone");

await browser.close();
```

- [ ] **Step 4: Run it and look at the screenshots**

```bash
cd "$E2E" && E2E="$E2E" bun e2e.mjs
```

Expected: every line starts with `ok`, no `FAIL`, exit code 0. Then open the four PNGs and look: quiet styling with the app's tokens, a sticky header, the board columns side by side with cards, no horizontal page scroll on the phone shot, popovers not clipped. If the row `eq(small, 0, ...)` fails, the message does not name the element; evaluate the same selector in a phone page and print `e.className` for the failures.

- [ ] **Step 5: Stop the dev stack and clean up**

```bash
pkill -f "bun --filter" ; pkill -f "vite" ; pkill -f "bun run --watch src/index.ts" ; true
```

Nothing from the scratch folder is committed. If a screenshot shows a defect, fix it in the task that owns the file and re-run Steps 1 to 4.

---

## Self-Review

Checked against `docs/plans/2026-11-26-properties-and-views-design.md`, Phase 2a:

- **Where views live, 2a:** the fence in a note, no new file kind, tree, permissions, history, MCP and search unchanged (no task touches them). Notes only (`.md`): Task 6 lists index entries. `map` shows "not supported yet" and keeps its config: Task 17 (`BaseView`). 2b is out of this plan (decision 11 and Global Constraints).
- **Format:** both Obsidian-written files are fixtures in Task 1 (parse) and Task 2 (byte-for-byte splice). Unknown keys round-trip: Task 2 tests (`unknown: {a: 1}`, comments, CRLF, no trailing newline). An expression YAML would misread is quoted: Task 2 ("expressions that YAML would misread are quoted") and Task 8 (`simpleBase`).
- **Expression language:** grammar and Pratt parser: Task 3. Function list, own-property access, method dispatch table, step budget, unsupported function gives null plus a warning, no regexes: Task 4. Date `format` subset and duration arithmetic: Task 4 tests.
- **Server query:** `parse.ts`, `expr.ts`, `query.ts`, `functions.ts` (Tasks 1, 3, 4, 6); `POST /api/bases/query` with default 500 and max 2000 (Tasks 1, 6, 7); evaluation over `VaultIndex` entries with backlinks from the inbound map (Task 6; the revision gap and its fix are Task 5); visibility (hidden left out, own note left out) and permissions on rows and link cells (Tasks 6, 7); MCP `query_notes` paged (Task 8).
- **View UI:** toolbar with switcher, count, Sort, Filter, Properties, `+ New` (Tasks 16, 17); changes write back through the Document-preserving edit (Tasks 2, 17); table with sticky header, resize, cell editing, summaries, open-note edits through the editor path and others through `PATCH` with the row revision and 409 handling (Tasks 13, 17); cards, list (Task 14); kanban with groupBy, groupOrder, "No value" last, drag, menu twin, `+` preset, drop writes the property (Task 15); `+ New` rule (Tasks 11, 17); live re-query on focus, save and own writes (Task 17).
- **Touch and keyboard:** every drag has a menu twin (kanban `Move to`, column menu for resize and move, Properties popover up and down); 40px targets at `pointer: coarse` (Task 17 CSS, checked in Task 19).
- **MCP tool count 19 to 20** in README, `docs/mcp.md`, `mcp-prompt.md`, `instructions.ts`: Task 8.

Placeholder scan: no "TBD", "implement later" or "similar to Task N" remains; every code step carries its code.

Type consistency: `ViewConfig`, `BaseConfig`, `QueryEntry`, `QueryIndex`, `QueryDeps { index; allowed; types; now? }`, `runBaseQuery(req, deps)`, `BaseHost { currentPath; edit; editFence; openNote; openLink; noteExists; createNote; toast }`, `LayoutProps { result; config; view; vaultTypes; host; saveProps; editView; newNote }`, `setViewSort(src, view, sort)` and the other `setView*` names are used with the same signatures in Tasks 2, 8, 13, 15, 16 and 17.

**What was actually run while writing this plan.** Phase 1 had not landed in the worktree, so the plan was written against its text. Run for real, in a scratch copy with a stub of Phase 1's `@brainmd/shared` types: the shared modules and every server module of Tasks 1 to 4 and 6 and 8's `simple.ts` with their tests (the code in the plan is that code), and every web module of Tasks 9, 10 and 11 with their tests (the renderer test ran against the real renderer sources). The components of Tasks 12 to 17 were type-checked with `tsc` and linted with Biome against the real web sources plus stubs for `editContent`, `minimalChange` and `api.properties()`. **Not run:** Task 5 (index revision), Task 7 (route and its test), Task 8's MCP tool and its test (all need Phase 1's index, registry and routes), the `Preview` and `App` wiring in Task 17, the CSS, and the Task 19 script. Expect small fixes there, and treat Task 19 as the first time the UI runs.

Known limits and risks, stated so nobody is surprised: summaries cover the loaded page (decision 4); `file.name` versus Obsidian's meaning, `columnSize` and the cover `image` key are unconfirmed (decisions 6, 8, 9); a row that is the open note cannot occur in 2a (decision 7); the step budget is per note (decision 15); focus is lost when an edit rewrites the fence (decision 14); `.base` files, `![[x.base]]` embeds and the Tasks-style query language are 2b and later.
