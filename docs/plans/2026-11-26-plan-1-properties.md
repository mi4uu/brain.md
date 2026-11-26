# Properties Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typed frontmatter properties in brain.md: a vault-wide property index and type registry, byte-minimal frontmatter edits, REST and MCP endpoints to change properties, and a Properties panel in the web UI.

**Architecture:** A new workspace package `@brainmd/shared` holds the frontmatter read/edit module and the property type helpers, so server and web use one implementation. Edits splice the YAML source text by node ranges (never `Document.toString()`), so a changed property touches only its own bytes. The index keeps each note's whole frontmatter as `props`; the type registry is a small JSON file; every write goes through `vault.mutateNote`. The panel edits the open note through a CodeMirror transaction.

**Tech Stack:** Bun workspaces, TypeScript, `yaml` 2.x, Elysia, MCP SDK with zod 4, React 18, CodeMirror 6, Radix, cmdk. Tests: `bun test`.

**Spec:** `docs/plans/2026-11-26-properties-and-views-design.md` (Phase 1 and the Contracts section; Contracts are binding).

## Global Constraints

- Commit steps show the planning session's `Claude-Session:` trailer. The executing session replaces it with its own trailer.
- No em dashes anywhere: code, comments, docs, commit messages. Scan before every commit: `git diff --cached | grep -nP "\x{2014}"` must print nothing.
- Comments only for a non-obvious reason, an outside constraint or a workaround. Do not caption what the code says.
- Code, comments, docs and commit messages in English.
- Every commit message ends with this trailer line, after a blank line: `Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA`
- MCP tool count goes 18 -> 19 (`update_properties`). Update `README.md`, `docs/mcp.md`, `mcp-prompt.md` and `server/src/mcp/instructions.ts` in Task 6, the task that adds the tool.
- Phones are first-class: touch targets are 40px at `pointer: coarse`, and nothing may depend on hover or drag.
- Every property write goes through the vault write path (`vault.mutateNote`), so git attribution, the Changes view, `base_revision` and folder permissions apply unchanged.
- Never loosen `assertMarkdown`. No new route may touch non-`.md` files.
- Contract names, types and routes are exactly those in the spec: `readFrontmatter`, `setProperties`, `renameProperty`, `FrontmatterError`, `PropValue`, `FrontmatterRead`, `PropertyType`, `TypesFile`, `inferType`, `PropertyInfo`, `VaultIndex.propertyKeys`, `IndexEntry.props` and `ctime`, `GET /api/properties`, `PUT /api/properties/types`, `PATCH /api/note-properties/*`, MCP `update_properties`, `read_note.properties`.
- Server tests: `cd server && bun test test/<file>`. Typecheck: `bun run typecheck` at the repo root. Web tests: `cd web && bun test`. Web build: `bun run --cwd web build`.
- UI: quiet, existing tokens only (`var(--text-1..4)`, `var(--border)`, `var(--bg-hover)`, `var(--accent)`, `var(--radius-*)`, `var(--font-mono)` for dates and numbers). No new colours.

## Decisions where the spec was silent or inconsistent

These are settled here so executors do not re-decide them.

1. The spec's "Throws FrontmatterError" comment sits under `readFrontmatter`, but `FrontmatterRead` has an `error` field. `readFrontmatter` never throws; `setProperties` and `renameProperty` throw `FrontmatterError`.
2. `setProperties` on a note with no frontmatter prepends a new `---` block (line ending taken from the note, BOM kept). A bare `---\n---` pair with nothing between is not treated as frontmatter, the same as the index today.
3. A key in both `set` and `unset` is set. `renameProperty` returns the content unchanged when `from` is missing or `to` already exists.
4. `null` is written as an empty value (`key:`), as Obsidian does.
5. `PATCH` returns 422 with `{ code, error }` for both `INVALID_YAML` and `NOT_A_MAPPING`. Bad input (empty call, `__proto__`, more than 100 keys, depth over 8) is 400 via a new `VaultError` code `INVALID_VALUE`.
6. `PropertyInfo` is defined in `@brainmd/shared/property-types` and re-exported by the server index, so web and server share it. `VaultIndex.propertyKeys(allowed?)` keeps the contract signature and returns inferred types only; the registry is applied in `listProperties` (`server/src/properties/registry.ts`). `resolveType(name, registered, inferred)` is the one place that makes `tags` and `aliases` fixed.
7. `.brain/types.json` is not a note. It is written with `atomicWrite` like settings and folder meta, so it does not appear in git history or the Changes view (`.brain/` is gitignored). The spec's "every write goes through the vault write path" applies to notes.
8. A caller who can write but not read a note (write-only folder) gets no `revision` back and cannot pass `base_revision` (it needs read permission), and YAML error text is replaced by a generic message, because yaml errors quote the source. This follows `append_note`.
9. The spec asks for the tool count in `instructions.ts`, but that file contains no count. Task 6 adds a bullet about `update_properties` there and in `mcp-prompt.md` instead.
10. Two existing tests must change when the tool and routes land: `server/test/mcp.apps.test.ts` (it lists the write tools) and `server/test/route-principal-matrix.test.ts` (every route and tool gets a row).
11. The server's frontmatter regex gains an optional BOM (`﻿`) so the index agrees with the shared module on BOM notes.
12. The panel header is always shown for an open note ("Properties (n)"). When the preview is hidden (Editor-only layout, or the mobile Edit tab) the panel sits above the editor and starts collapsed.

## File Structure

| File | Responsibility |
|---|---|
| `shared/package.json` (new) | workspace package `@brainmd/shared`, exports `./*` -> `./src/*.ts` |
| `shared/src/frontmatter.ts` (new) | read, splice-edit and rename frontmatter; `PropValue`, `FrontmatterError` |
| `shared/src/property-types.ts` (new) | `PropertyType`, `inferType`, `resolveType`, `PropertyInfo`, date regexes |
| `server/src/index/parse.ts` | BOM-tolerant frontmatter regex |
| `server/src/index/index.ts` | `props`, `ctime`, version 3, `propertyKeys` |
| `server/src/properties/registry.ts` (new) | `.brain/types.json` and `.obsidian/types.json`, `listProperties` |
| `server/src/properties/update.ts` (new) | `updateProperties`, the one property write path (REST and MCP) |
| `server/src/api/properties.ts` (new) | `GET /api/properties`, `PUT /api/properties/types`, `PATCH /api/note-properties/*` |
| `server/src/mcp/server.ts` | `update_properties`, `read_note.properties` |
| `web/src/properties/model.ts` (new) | pure panel model, edit functions, value helpers, `minimalChange` |
| `web/src/properties/type-meta.tsx`, `useProperties.ts` (new) | type labels and icons; vault property list hook |
| `web/src/components/properties/*.tsx` (new) | `ValueEditor`, `TypeButton`, `AddProperty`, `PropertiesPanel` |
| `web/src/styles/properties.css` (new) | panel styles |
| `web/src/App.tsx`, `components/Preview.tsx` | mount the panel, route edits through the editor |

---

### Task 1: Shared package and frontmatter module

**Files:**
- Create: `shared/package.json`, `shared/src/frontmatter.ts`
- Modify: `package.json` (root), `server/package.json`, `web/package.json`, `bun.lock`
- Test: `server/test/shared.frontmatter.test.ts`

**Interfaces:**
- Produces (exact, from the spec): `type PropValue`, `interface FrontmatterRead`, `class FrontmatterError { code: "INVALID_YAML" | "NOT_A_MAPPING" }`, `readFrontmatter(content: string): FrontmatterRead`, `setProperties(content: string, set: Record<string, PropValue>, unset?: string[]): string`, `renameProperty(content: string, from: string, to: string): string`. Also `toPropValue(v: unknown): PropValue` (JSON-safe copy of parsed YAML, drops `__proto__`), used by the index in Task 3.

- [ ] **Step 1: Create the workspace package**

`shared/package.json`:

```json
{
  "name": "@brainmd/shared",
  "private": true,
  "type": "module",
  "exports": {
    "./*": "./src/*.ts"
  },
  "dependencies": {
    "yaml": "^2.6.0"
  }
}
```

In root `package.json` change `"workspaces": ["server", "web"]` to `"workspaces": ["shared", "server", "web"]`. In both `server/package.json` and `web/package.json` add `"@brainmd/shared": "workspace:*"` to `dependencies` (keep alphabetical order). Then run `bun install` at the repo root (updates `bun.lock`; CI uses `--frozen-lockfile`, so commit it).

- [ ] **Step 2: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { readFrontmatter, setProperties, renameProperty, FrontmatterError } from "@brainmd/shared/frontmatter";

const wrap = (y: string, eol = "\n") => `---${eol}${y}${eol}---${eol}body${eol}`;

test("scalar replace keeps comment, odd spacing, 007", () => {
  const src = wrap("# top\nid: 007\ntitle:   Foo  # why\nstatus: todo");
  const out = setProperties(src, { title: "Bar" });
  expect(out).toBe(wrap("# top\nid: 007\ntitle:   Bar  # why\nstatus: todo"));
});
test("crlf block list replace", () => {
  const src = wrap("tags:\r\n- a\r\n- b\r\nx: 1", "\r\n");
  const out = setProperties(src, { tags: ["a", "c", "d"] });
  expect(out).toBe(wrap("tags:\r\n- a\r\n- c\r\n- d\r\nx: 1", "\r\n"));
});
test("indented block list", () => {
  const src = wrap("tags:\n    - a\n    - b\nx: 1");
  expect(setProperties(src, { tags: ["z"] })).toBe(wrap("tags:\n    - z\nx: 1"));
});
test("block list last pair no trailing newline in raw", () => {
  const src = wrap("x: 1\ntags:\n  - a\n  - b");
  expect(setProperties(src, { tags: ["q", "r"] })).toBe(wrap("x: 1\ntags:\n  - q\n  - r"));
});
test("flow list", () => {
  const src = wrap("tags: [x, y]  # c\nk: v");
  expect(setProperties(src, { tags: ["x", "y", "z"] })).toBe(wrap("tags: [x, y, z]  # c\nk: v"));
});
test("scalar -> list and list -> scalar", () => {
  expect(setProperties(wrap("a: 1\nb: x"), { b: ["p", "q"] })).toBe(wrap("a: 1\nb:\n  - p\n  - q"));
  expect(setProperties(wrap("b:\n  - p\n  - q\nc: 1"), { b: "s" })).toBe(wrap("b: s\nc: 1"));
  expect(setProperties(wrap("b:\r\n- p\r\n- q\r\nc: 1", "\r\n"), { b: "s" })).toBe(wrap("b: s\r\nc: 1", "\r\n"));
});
test("empty list", () => {
  expect(setProperties(wrap("b:\n  - p\nc: 1"), { b: [] })).toBe(wrap("b: []\nc: 1"));
});
test("append, wikilink quoting, types", () => {
  const out = setProperties(wrap("a: 1"), { link: "[[Note]]", n: 3, ok: true,  "my key": "v", d: "2026-11-26", s: "007" });
  expect(out).toBe(wrap('a: 1\nlink: "[[Note]]"\nn: 3\nok: true\nmy key: v\nd: 2026-11-26\ns: "007"'));
  expect(readFrontmatter(out).props).toEqual({ a: 1, link: "[[Note]]", n: 3, ok: true,  "my key": "v", d: "2026-11-26", s: "007" });
});
test("append list and nested", () => {
  const out = setProperties(wrap("a: 1"), { tags: ["x", "[[L]]"], m: { k: 1 } });
  expect(readFrontmatter(out).props).toEqual({ a: 1, tags: ["x", "[[L]]"], m: { k: 1 } });
  expect(out).toContain('tags:\n  - x\n  - "[[L]]"\nm:\n  k: 1');
});
test("unset middle, last, only", () => {
  expect(setProperties(wrap("a: 1\nb: 2\nc: 3"), {}, ["b"])).toBe(wrap("a: 1\nc: 3"));
  expect(setProperties(wrap("a: 1\nb: 2\nc: 3"), {}, ["c"])).toBe(wrap("a: 1\nb: 2"));
  expect(setProperties(wrap("a: 1\nb:\n  - x\n  - y"), {}, ["b"])).toBe(wrap("a: 1"));
  expect(setProperties(wrap("a: 1\r\nb: 2", "\r\n"), {}, ["b"])).toBe(wrap("a: 1", "\r\n"));
  expect(readFrontmatter(setProperties(wrap("a: 1"), {}, ["a"])).props).toEqual({});
});
test("unset last + append", () => {
  expect(setProperties(wrap("a: 1\nb: 2"), { c: 3 }, ["b"])).toBe(wrap("a: 1\nc: 3"));
});
test("unset+set same key sets", () => {
  expect(setProperties(wrap("a: 1"), { a: 2 }, ["a"])).toBe(wrap("a: 2"));
});
test("BOM", () => {
  const src = "\uFEFF" + wrap("a: 1");
  expect(setProperties(src, { a: 2 })).toBe("\uFEFF" + wrap("a: 2"));
  expect(readFrontmatter(src).range).toEqual({ from: 1, to: 1 + "---\na: 1\n---".length });
});
test("no frontmatter creates block", () => {
  expect(setProperties("hello\n", { a: 1 })).toBe("---\na: 1\n---\nhello\n");
  expect(setProperties("hello\r\n", { a: 1 })).toBe("---\r\na: 1\r\n---\r\nhello\r\n");
  expect(setProperties("hello\n", {})).toBe("hello\n");
});
test("null value key", () => {
  expect(setProperties(wrap("a:\nb: 1"), { a: "x" })).toBe(wrap("a: x\nb: 1"));
  expect(setProperties(wrap("a:\r\nb: 1", "\r\n"), { a: "x" })).toBe(wrap("a: x\r\nb: 1", "\r\n"));
  expect(setProperties(wrap("a:\nb: 1"), { a: ["x"] })).toBe(wrap("a:\n  - x\nb: 1"));
});
test("block scalar replaced", () => {
  expect(setProperties(wrap("d: |\n  line1\n  line2\nb: 1"), { d: "x" })).toBe(wrap("d: x\nb: 1"));
});
test("nested map preserved, read", () => {
  const src = wrap("m:\n  k: 1\n  j: [a]\nz: 1");
  expect(setProperties(src, { z: 2 })).toBe(wrap("m:\n  k: 1\n  j: [a]\nz: 2"));
  expect(readFrontmatter(src).props).toEqual({ m: { k: 1, j: ["a"] }, z: 1 });
});
test("multi-line string", () => {
  const out = setProperties(wrap("a: 1"), { n: "l1\nl2" });
  expect(readFrontmatter(out).props!.n).toBe("l1\nl2");
});
test("errors", () => {
  const bad = wrap("a: [1\nb: : :");
  expect(readFrontmatter(bad).error).toBeString();
  expect(() => setProperties(bad, { a: 1 })).toThrow(FrontmatterError);
  try { setProperties(bad, { a: 1 }); } catch (e) { expect((e as FrontmatterError).code).toBe("INVALID_YAML"); }
  try { setProperties(wrap("- a\n- b"), { a: 1 }); } catch (e) { expect((e as FrontmatterError).code).toBe("NOT_A_MAPPING"); }
  expect(readFrontmatter(wrap("- a")).error).toBe("frontmatter must be YAML mapping");
  expect(readFrontmatter("no fm")).toEqual({ props: null, error: null, range: null });
});
test("comment-only block", () => {
  expect(setProperties(wrap("# just a comment"), { a: 1 })).toBe(wrap("# just a comment\na: 1"));
});
test("rename", () => {
  expect(renameProperty(wrap("old: 1 # c\nx: 2"), "old", "new")).toBe(wrap("new: 1 # c\nx: 2"));
  expect(renameProperty(wrap("old: 1\nnew: 2"), "old", "new")).toBe(wrap("old: 1\nnew: 2"));
  expect(renameProperty(wrap("a: 1"), "zz", "q")).toBe(wrap("a: 1"));
});
test("proto key safe", () => {
  const r = readFrontmatter(wrap("a: 1\n__proto__: x"));
  expect(Object.keys(r.props ?? {})).toEqual(["a"]);
});
test("null values render as empty", () => {
  expect(setProperties(wrap("a: x # c\nb: 1"), { a: null })).toBe(wrap("a: # c\nb: 1"));
  expect(setProperties(wrap("a: 1"), { n: null })).toBe(wrap("a: 1\nn:"));
  expect(setProperties(wrap("a:\n  - x\nb: 1"), { a: null })).toBe(wrap("a:\nb: 1"));
  expect(readFrontmatter(setProperties(wrap("a: 1"), { n: null, m: 2 })).props).toEqual({ a: 1, n: null, m: 2 });
  expect(setProperties(wrap("a:\nb: 1"), { a: null })).toBe(wrap("a:\nb: 1"));
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd server && bun test test/shared.frontmatter.test.ts`
Expected: FAIL, cannot find module `@brainmd/shared/frontmatter`.

- [ ] **Step 4: Write the implementation**

How it works: the YAML text between the `---` lines is parsed with `keepSourceTokens`, each pair's `value.range` is `[start, valueEnd, nodeEnd]` into that text, and edits are spliced into the original string from the last to the first. Nothing else is re-serialised.

`shared/src/frontmatter.ts`:

```ts
import { isMap, isScalar, isSeq, parseDocument, stringify, type Document, type Pair, type YAMLMap } from "yaml";

export type PropValue = string | number | boolean | null | PropValue[] | { [k: string]: PropValue };

export interface FrontmatterRead {
  props: Record<string, PropValue> | null;
  error: string | null;
  range: { from: number; to: number } | null;
}

export class FrontmatterError extends Error {
  constructor(
    public code: "INVALID_YAML" | "NOT_A_MAPPING",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "FrontmatterError";
  }
}

const FM_RE = /^(\uFEFF?)---\r?\n([\s\S]*?)\r?\n---/;

interface Located {
  from: number;
  to: number;
  yamlStart: number;
  raw: string;
  eol: string;
}

function locate(content: string): Located | null {
  const m = FM_RE.exec(content);
  if (!m) return null;
  const from = (m[1] ?? "").length;
  const raw = m[2] ?? "";
  const eol = content.startsWith("\r\n", from + 3) ? "\r\n" : "\n";
  const yamlStart = from + 3 + eol.length;
  return { from, to: m[0].length, yamlStart, raw, eol };
}

export function toPropValue(v: unknown, depth = 0): PropValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (depth > 12) return null;
  if (Array.isArray(v)) return v.map((x) => toPropValue(x, depth + 1));
  if (v instanceof Map) {
    const out: Record<string, PropValue> = {};
    for (const [k, x] of v) if (String(k) !== "__proto__") out[String(k)] = toPropValue(x, depth + 1);
    return out;
  }
  if (typeof v === "object") {
    const out: Record<string, PropValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k !== "__proto__") out[k] = toPropValue(x, depth + 1);
    }
    return out;
  }
  return String(v);
}

function parseBlock(raw: string): Document.Parsed {
  return parseDocument(raw, { keepSourceTokens: true });
}

export function readFrontmatter(content: string): FrontmatterRead {
  const loc = locate(content);
  if (!loc) return { props: null, error: null, range: null };
  const range = { from: loc.from, to: loc.to };
  const doc = parseBlock(loc.raw);
  if (doc.errors.length > 0) return { props: null, error: doc.errors[0]!.message, range };
  if (doc.contents === null) return { props: {}, error: null, range };
  if (!isMap(doc.contents)) return { props: null, error: "frontmatter must be YAML mapping", range };
  return { props: toPropValue(doc.toJS()) as Record<string, PropValue>, error: null, range };
}

function renderInlineScalar(v: string | number | boolean | null): string {
  if (typeof v === "string") {
    if (v.includes("\n") || v.startsWith("[[")) return JSON.stringify(v);
    return stringify(v, { lineWidth: 0 }).trimEnd();
  }
  if (v === null) return "null";
  return String(v);
}

function isScalarValue(v: PropValue): v is string | number | boolean | null {
  return v === null || typeof v !== "object";
}

function renderFlow(v: PropValue[]): string {
  return `[${v.map((x) => (isScalarValue(x) ? renderInlineScalar(x) : JSON.stringify(x))).join(", ")}]`;
}

// A non-scalar value as block lines, each prefixed with `indent`.
function renderBlock(v: PropValue, indent: string, eol: string): string {
  if (Array.isArray(v) && v.length === 0) return "[]";
  if (!Array.isArray(v) && typeof v === "object" && v !== null && Object.keys(v).length === 0) return "{}";
  const lines: string[] = [];
  if (Array.isArray(v) && v.every(isScalarValue)) {
    for (const x of v) lines.push(`- ${renderInlineScalar(x as string | number | boolean | null)}`);
  } else {
    lines.push(...stringify(v, { indent: 2, lineWidth: 0 }).trimEnd().split("\n"));
  }
  return lines.map((l) => indent + l).join(eol);
}

function detectIndent(raw: string): string {
  const m = /^( +)\S/m.exec(raw);
  return m ? m[1]! : "  ";
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function lineStartOf(raw: string, pos: number): number {
  return raw.lastIndexOf("\n", pos - 1) + 1;
}

function endOfLine(raw: string, pos: number): number {
  if (pos >= raw.length || raw[pos - 1] === "\n") return Math.min(pos, raw.length);
  const nl = raw.indexOf("\n", pos);
  return nl < 0 ? raw.length : nl + 1;
}

function keyName(p: Pair): string | null {
  return isScalar(p.key) ? String(p.key.value) : null;
}

function findPair(map: YAMLMap, name: string): { pair: Pair; index: number } | null {
  const items = map.items as Pair[];
  for (let i = 0; i < items.length; i++) {
    if (keyName(items[i]!) === name) return { pair: items[i]!, index: i };
  }
  return null;
}

function keyRange(p: Pair): [number, number, number] {
  return (p.key as { range: [number, number, number] }).range;
}

function openBlock(loc: Located): { doc: Document.Parsed; map: YAMLMap | null } {
  const doc = parseBlock(loc.raw);
  if (doc.errors.length > 0) throw new FrontmatterError("INVALID_YAML", doc.errors[0]!.message);
  if (doc.contents === null) return { doc, map: null };
  if (!isMap(doc.contents)) throw new FrontmatterError("NOT_A_MAPPING", "frontmatter must be YAML mapping");
  return { doc, map: doc.contents };
}

function applyEdits(raw: string, edits: Edit[]): string {
  let out = raw;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

function replaceValue(raw: string, pair: Pair, value: PropValue, eol: string, indentUnit: string): Edit {
  const kr = keyRange(pair);
  const node = pair.value as { range?: [number, number, number]; flow?: boolean; type?: string } | null;
  const afterColon = raw.indexOf(":", kr[1]) + 1;
  const nonScalar = !isScalarValue(value);

  if (!node || !node.range || node.range[0] === node.range[1]) {
    const gap = /^[ \t]*/.exec(raw.slice(afterColon))![0].length;
    if (value === null) return { start: afterColon, end: afterColon + gap, text: "" };
    const body = nonScalar && !(Array.isArray(value) && value.length === 0)
      ? `${eol}${renderBlock(value, indentUnit, eol)}`
      : ` ${nonScalar ? renderBlock(value, "", eol) : renderInlineScalar(value)}`;
    return { start: afterColon, end: afterColon + gap, text: body };
  }

  const [vStart, vEnd] = node.range;
  const isBlockSeq = isSeq(pair.value) && !node.flow;
  const isBlockMap = isMap(pair.value) && !node.flow;
  const isBlockScalar = isScalar(pair.value) && (node.type === "BLOCK_LITERAL" || node.type === "BLOCK_FOLDED");
  const oldBlock = isBlockSeq || isBlockMap || isBlockScalar;
  const oldText = raw.slice(vStart, vEnd);
  const trailingEol = oldText.endsWith("\n") ? eol : "";

  if (value === null) return { start: afterColon, end: vEnd, text: trailingEol };

  if (isBlockSeq && Array.isArray(value) && value.length > 0 && value.every(isScalarValue)) {
    const indent = raw.slice(lineStartOf(raw, vStart), vStart);
    const items = value.map((x, i) => `${i === 0 ? "" : indent}- ${renderInlineScalar(x as string | number | boolean | null)}`);
    return { start: vStart, end: vEnd, text: items.join(eol) + trailingEol };
  }
  if (isSeq(pair.value) && node.flow && Array.isArray(value) && value.every(isScalarValue)) {
    return { start: vStart, end: vEnd, text: renderFlow(value) };
  }
  if (!nonScalar || (Array.isArray(value) && value.length === 0) || (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0)) {
    const inline = nonScalar ? renderBlock(value, "", eol) : renderInlineScalar(value);
    if (oldBlock) return { start: afterColon, end: vEnd, text: ` ${inline}${trailingEol}` };
    return { start: vStart, end: vEnd, text: inline };
  }
  const block = `${eol}${renderBlock(value, indentUnit, eol)}`;
  return { start: afterColon, end: vEnd, text: block + trailingEol };
}

function deletePairEdit(raw: string, map: YAMLMap, index: number, eol: string): Edit {
  const items = map.items as Pair[];
  const start = lineStartOf(raw, keyRange(items[index]!)[0]);
  let end: number;
  if (index + 1 < items.length) {
    end = lineStartOf(raw, keyRange(items[index + 1]!)[0]);
  } else {
    const v = items[index]!.value as { range?: [number, number, number] } | null;
    const tail = v?.range ? v.range[2] : keyRange(items[index]!)[2];
    end = endOfLine(raw, tail);
  }
  if (end >= raw.length && start > 0) {
    return { start: start - (raw[start - 2] === "\r" ? 2 : 1), end: raw.length, text: "" };
  }
  return { start, end, text: "" };
}

function newBlock(content: string, set: Record<string, PropValue>): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const rest = bom ? content.slice(1) : content;
  const lines: string[] = [];
  for (const [k, v] of Object.entries(set)) lines.push(...appendLines(k, v, "  ", eol));
  return `${bom}---${eol}${lines.join(eol)}${eol}---${eol}${rest}`;
}

function appendLines(key: string, v: PropValue, indent: string, eol: string): string[] {
  const k = renderInlineScalar(key);
  if (v === null) return [`${k}:`];
  if (isScalarValue(v)) return [`${k}: ${renderInlineScalar(v)}`];
  const b = renderBlock(v, indent, eol);
  return b === "[]" || b === "{}" ? [`${k}: ${b}`] : [`${k}:`, ...b.split(eol)];
}

export function setProperties(content: string, set: Record<string, PropValue>, unset: string[] = []): string {
  const loc = locate(content);
  const setKeys = Object.keys(set);
  if (!loc) return setKeys.length === 0 ? content : newBlock(content, set);
  const { map } = openBlock(loc);
  const indentUnit = detectIndent(loc.raw);
  const edits: Edit[] = [];
  const appended: string[] = [];

  for (const name of unset) {
    if (name in set) continue;
    const hit = map ? findPair(map, name) : null;
    if (hit && map) edits.push(deletePairEdit(loc.raw, map, hit.index, loc.eol));
  }
  for (const [name, value] of Object.entries(set)) {
    const hit = map ? findPair(map, name) : null;
    if (hit) edits.push(replaceValue(loc.raw, hit.pair, value, loc.eol, indentUnit));
    else appended.push(...appendLines(name, value, indentUnit, loc.eol));
  }
  if (appended.length > 0) {
    const lead = loc.raw === "" ? "" : loc.eol;
    edits.push({ start: loc.raw.length, end: loc.raw.length, text: lead + appended.join(loc.eol) });
  }
  if (edits.length === 0) return content;
  const nextRaw = applyEdits(loc.raw, edits);
  return content.slice(0, loc.yamlStart) + nextRaw + content.slice(loc.yamlStart + loc.raw.length);
}

export function renameProperty(content: string, from: string, to: string): string {
  const loc = locate(content);
  if (!loc || from === to) return content;
  const { map } = openBlock(loc);
  if (!map) return content;
  const hit = findPair(map, from);
  if (!hit || findPair(map, to)) return content;
  const [ks, ke] = keyRange(hit.pair);
  const nextRaw = loc.raw.slice(0, ks) + renderInlineScalar(to) + loc.raw.slice(ke);
  return content.slice(0, loc.yamlStart) + nextRaw + content.slice(loc.yamlStart + loc.raw.length);
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `cd server && bun test test/shared.frontmatter.test.ts && cd .. && bun run typecheck`
Expected: PASS (24 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add shared package.json server/package.json web/package.json bun.lock server/test/shared.frontmatter.test.ts
git commit -m "feat(shared): frontmatter read and splice editing in a workspace package" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 2: Property types

**Files:**
- Create: `shared/src/property-types.ts`
- Test: `server/test/shared.property-types.test.ts`

**Interfaces:**
- Consumes: `PropValue` from `@brainmd/shared/frontmatter`.
- Produces: `PROPERTY_TYPES` (readonly tuple), `type PropertyType`, `interface TypesFile { types: Record<string, string> }`, `interface PropertyInfo { name; type; count; values }`, `DATE_RE`, `DATETIME_RE`, `isPropertyType(s: unknown): s is PropertyType`, `normalizeType(s: unknown): PropertyType` (unknown -> `"text"`), `inferType(values: PropValue[]): PropertyType`, `resolveType(name: string, registered: PropertyType | undefined, inferred: PropertyType): PropertyType`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "bun:test";
import { inferType, normalizeType } from "@brainmd/shared/property-types";
test("infer", () => {
  expect(inferType([])).toBe("text");
  expect(inferType([null, true, false])).toBe("checkbox");
  expect(inferType([1, 2.5])).toBe("number");
  expect(inferType(["2026-11-26", "2026-01-01"])).toBe("date");
  expect(inferType(["2026-11-26", "2026-11-26T10:30"])).toBe("datetime");
  expect(inferType(["2026-11-26T10:30:00Z"])).toBe("datetime");
  expect(inferType([["a"], "b"])).toBe("multitext");
  expect(inferType([1, "a"])).toBe("text");
  expect(inferType([{ a: 1 }])).toBe("text");
  expect(normalizeType("List")).toBe("text");
  expect(normalizeType("multitext")).toBe("multitext");
});
import { resolveType } from "@brainmd/shared/property-types";
test("resolveType", () => {
  expect(resolveType("tags", "text", "text")).toBe("tags");
  expect(resolveType("aliases", undefined, "text")).toBe("aliases");
  expect(resolveType("due", "datetime", "date")).toBe("datetime");
  expect(resolveType("due", undefined, "date")).toBe("date");
  expect(resolveType("constructor", undefined, "number")).toBe("number");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && bun test test/shared.property-types.test.ts`
Expected: FAIL, cannot find module `@brainmd/shared/property-types`.

- [ ] **Step 3: Write the implementation**

`shared/src/property-types.ts`:

```ts
import type { PropValue } from "./frontmatter";

export const PROPERTY_TYPES = ["text", "multitext", "number", "checkbox", "date", "datetime", "tags", "aliases"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface TypesFile {
  types: Record<string, string>;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function isPropertyType(s: unknown): s is PropertyType {
  return typeof s === "string" && (PROPERTY_TYPES as readonly string[]).includes(s);
}

export function normalizeType(s: unknown): PropertyType {
  return isPropertyType(s) ? s : "text";
}

export function inferType(values: PropValue[]): PropertyType {
  const vs = values.filter((v) => v !== null);
  if (vs.length === 0) return "text";
  if (vs.some((v) => Array.isArray(v))) return "multitext";
  if (vs.every((v) => typeof v === "boolean")) return "checkbox";
  if (vs.every((v) => typeof v === "number")) return "number";
  if (vs.every((v) => typeof v === "string")) {
    const strs = vs as string[];
    if (strs.every((s) => DATE_RE.test(s))) return "date";
    if (strs.every((s) => DATE_RE.test(s) || DATETIME_RE.test(s))) return "datetime";
  }
  return "text";
}

export interface PropertyInfo {
  name: string;
  type: PropertyType;
  count: number;
  values: PropValue[];
}

const FIXED_TYPES: Record<string, PropertyType> = { tags: "tags", aliases: "aliases" };

// `tags` and `aliases` are fixed; otherwise a registered type wins over the
// inferred one.
export function resolveType(name: string, registered: PropertyType | undefined, inferred: PropertyType): PropertyType {
  if (Object.hasOwn(FIXED_TYPES, name)) return FIXED_TYPES[name]!;
  return registered ?? inferred;
}
```

- [ ] **Step 4: Run the test and the typecheck**

Run: `cd server && bun test test/shared.property-types.test.ts && cd .. && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add shared/src/property-types.ts server/test/shared.property-types.test.ts
git commit -m "feat(shared): property types, inference and type resolution" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 3: Index keeps properties

**Files:**
- Modify: `server/src/index/parse.ts`, `server/src/index/index.ts`
- Test: `server/test/index.properties.test.ts`

**Interfaces:**
- Consumes: `toPropValue`, `PropValue` (Task 1); `inferType`, `resolveType`, `PropertyInfo` (Task 2).
- Produces: `IndexEntry.props: Record<string, PropValue>`, `IndexEntry.ctime: number`, `IndexData.version: 3`, `VaultIndex.propertyKeys(allowed?: (path: string) => boolean): PropertyInfo[]` (types are inferred only; most used first; `values` up to 20, most common first, list items counted one by one), `export type { PropertyInfo }` from `server/src/index/index.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { VaultIndex } from "../src/index/index";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-props-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, content: string) {
  await h.vault.writeNote(path, content);
  await h.index.updatePath(path);
}

describe("index keeps frontmatter properties", () => {
  test("props hold the whole mapping, JSON-safe, and ctime is set", async () => {
    await put("a.md", "---\nstatus: todo\ncount: 3\ndone: false\ndue: 2026-12-01\ntags: [x, y]\nnested:\n  k: 1\nempty:\n---\n# A\n");
    const e = h.index.get("a.md")!;
    expect(e.props).toEqual({
      status: "todo",
      count: 3,
      done: false,
      due: "2026-12-01",
      tags: ["x", "y"],
      nested: { k: 1 },
      empty: null,
    });
    expect(e.ctime).toBeGreaterThan(0);
  });

  test("a note without frontmatter, or with invalid frontmatter, has empty props", async () => {
    await put("plain.md", "# plain\n");
    await put("bad.md", "---\na: [1\n---\nbody\n");
    expect(h.index.get("plain.md")!.props).toEqual({});
    expect(h.index.get("bad.md")!.props).toEqual({});
  });

  test("a leading BOM does not hide the frontmatter", async () => {
    await put("bom.md", "﻿---\nstatus: ok\n---\nbody\n");
    expect(h.index.get("bom.md")!.props).toEqual({ status: "ok" });
  });

  test("a __proto__ key never reaches props", async () => {
    await put("p.md", "---\na: 1\n__proto__: x\n---\n");
    expect(Object.keys(h.index.get("p.md")!.props)).toEqual(["a"]);
  });

  test("rename keeps props", async () => {
    await put("old.md", "---\na: 1\n---\n");
    h.index.rename("old.md", "new.md");
    expect(h.index.get("new.md")!.props).toEqual({ a: 1 });
  });
});

describe("propertyKeys", () => {
  beforeEach(async () => {
    await put("a.md", "---\nstatus: todo\nprio: 1\ntags: [x, y]\ndue: 2026-12-01\n---\n");
    await put("b.md", "---\nstatus: todo\nprio: 2\ntags: [x]\ndone: true\n---\n");
    await put("c.md", "---\nstatus: done\ndue: 2026-12-02T10:00\n---\n");
    await put("secret/d.md", "---\nstatus: hidden-value\nonly_secret: 1\n---\n");
  });

  test("counts, inferred types, most used first, values by frequency", async () => {
    const infos = h.index.propertyKeys();
    const byName = Object.fromEntries(infos.map((i) => [i.name, i]));
    expect(infos[0]!.name).toBe("status");
    expect(byName.status).toMatchObject({ count: 4, type: "text" });
    expect(byName.status!.values.slice(0, 2)).toEqual(["todo", "done"]);
    expect(byName.prio).toMatchObject({ count: 2, type: "number" });
    expect(byName.tags).toMatchObject({ count: 2, type: "tags", values: ["x", "y"] });
    expect(byName.due).toMatchObject({ count: 2, type: "datetime" });
    expect(byName.done).toMatchObject({ count: 1, type: "checkbox", values: [true] });
  });

  test("the read filter drops notes, so their keys and values disappear", async () => {
    const infos = h.index.propertyKeys((p) => !p.startsWith("secret/"));
    expect(infos.some((i) => i.name === "only_secret")).toBe(false);
    expect(infos.find((i) => i.name === "status")!.values).not.toContain("hidden-value");
  });

  test("values are capped at 20", async () => {
    for (let i = 0; i < 30; i++) await put(`many/n${i}.md`, `---\nuniq: v${i}\n---\n`);
    expect(h.index.propertyKeys().find((i) => i.name === "uniq")!.values.length).toBe(20);
  });
});

describe("snapshot version 3", () => {
  test("an older snapshot is rebuilt instead of trusted", async () => {
    await h.vault.writeNote("a.md", "---\nstatus: todo\n---\n");
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/index.json"), JSON.stringify({ version: 2, entries: {} }));
    const idx = new VaultIndex(h.vault);
    await idx.loadOrBuild();
    expect(idx.snapshot().version).toBe(3);
    expect(idx.get("a.md")!.props).toEqual({ status: "todo" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && bun test test/index.properties.test.ts`
Expected: FAIL (`props` undefined, `propertyKeys` is not a function).

- [ ] **Step 3: Apply the change**

Apply this diff (`git apply`, or by hand):

```diff
--- a/server/src/index/parse.ts
+++ b/server/src/index/parse.ts
@@ -19,7 +19,7 @@
   links: WikilinkRef[];
 }
 
-const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
+const FM_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
 
 export function splitFrontmatter(content: string): {
   fm: Record<string, unknown> | null;
```

```diff
--- a/server/src/index/index.ts
+++ b/server/src/index/index.ts
@@ -3,6 +3,8 @@
 import type { Vault, MutationEvent } from "../vault/vault";
 import { atomicWrite } from "../vault/atomic-write";
 import { basenameNoExt } from "../vault/paths";
+import { toPropValue, type PropValue } from "@brainmd/shared/frontmatter";
+import { inferType, resolveType, type PropertyInfo } from "@brainmd/shared/property-types";
 import { parseNote } from "./parse";
 import { LinkResolver } from "./resolve";
 
@@ -29,11 +31,18 @@
   // and `search: false` (visible in the tree, out of search, graph, RAG).
   hidden?: boolean;
   noSearch?: boolean;
+  // The whole frontmatter mapping, JSON-safe; {} when there is none.
+  props: Record<string, PropValue>;
+  // File birth time; mtime where the filesystem does not report one.
+  ctime: number;
 }
 
+export type { PropertyInfo };
+
 export interface IndexData {
-  // 2 added the hidden/noSearch flags; an older snapshot is rebuilt.
-  version: 2;
+  // 2 added the hidden/noSearch flags, 3 added props and ctime; an older
+  // snapshot is rebuilt.
+  version: 3;
   entries: Record<string, IndexEntry>;
 }
 
@@ -49,7 +58,7 @@
   // Set by app.ts (vault/visibility.ts). Search, graph and list_notes
   // consult it; absent in unit tests, where nothing is hidden.
   visibility?: VisibilityRules;
-  private data: IndexData = { version: 2, entries: {} };
+  private data: IndexData = { version: 3, entries: {} };
   private unsubscribe?: () => void;
   private persistTimer: ReturnType<typeof setTimeout> | null = null;
   // Resolved link targets and the inbound links they give each note, rebuilt
@@ -210,6 +219,45 @@
       .sort((a, b) => a.tag.localeCompare(b.tag));
   }
 
+  // Every frontmatter key in the notes `allowed` lets through, with how many
+  // notes use it, the type their values suggest and up to 20 of the most
+  // common scalar values (list items are counted one by one). Registry
+  // overrides are applied by the caller (properties/registry.ts).
+  propertyKeys(allowed?: (path: string) => boolean): PropertyInfo[] {
+    const acc = new Map<string, { count: number; raw: PropValue[]; freq: Map<string, { v: PropValue; n: number }> }>();
+    for (const e of this.entries()) {
+      if (allowed && !allowed(e.path)) continue;
+      for (const [name, value] of Object.entries(e.props)) {
+        let a = acc.get(name);
+        if (!a) {
+          a = { count: 0, raw: [], freq: new Map() };
+          acc.set(name, a);
+        }
+        a.count++;
+        if (value !== null) a.raw.push(value);
+        for (const item of Array.isArray(value) ? value : [value]) {
+          if (item === null || typeof item === "object") continue;
+          if (typeof item === "string" && item.length > 200) continue;
+          const key = `${typeof item}:${item}`;
+          const hit = a.freq.get(key);
+          if (hit) hit.n++;
+          else a.freq.set(key, { v: item, n: 1 });
+        }
+      }
+    }
+    return Array.from(acc.entries())
+      .map(([name, a]) => ({
+        name,
+        type: resolveType(name, undefined, inferType(a.raw)),
+        count: a.count,
+        values: Array.from(a.freq.values())
+          .sort((x, y) => y.n - x.n || String(x.v).localeCompare(String(y.v)))
+          .slice(0, 20)
+          .map((x) => x.v),
+      }))
+      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
+  }
+
   private invalidateLinks(): void {
     this.links = undefined;
   }
@@ -255,7 +303,7 @@
         if (e) next[p] = e;
       }),
     );
-    this.data = { version: 2, entries: next };
+    this.data = { version: 3, entries: next };
     this.invalidateLinks();
   }
 
@@ -322,6 +370,7 @@
       const data = await this.vault.readNote(path);
       const parsed = parseNote(data.content);
       const bn = basenameNoExt(path);
+      const st = await stat(this.vault.abs(path));
       return {
         path,
         mtime: data.mtime,
@@ -343,6 +392,8 @@
         body: parsed.body,
         hidden: parsed.frontmatter?.hidden === true || undefined,
         noSearch: parsed.frontmatter?.search === false || undefined,
+        props: parsed.frontmatter ? (toPropValue(parsed.frontmatter) as Record<string, PropValue>) : {},
+        ctime: st.birthtimeMs > 0 ? st.birthtimeMs : data.mtime,
       };
     } catch {
       return null;
@@ -360,7 +411,7 @@
     try {
       const raw = await readFile(abs, "utf8");
       const parsed = JSON.parse(raw) as IndexData;
-      if (parsed.version === 2) {
+      if (parsed.version === 3) {
         this.data = parsed;
         this.invalidateLinks();
         return true;
```

- [ ] **Step 4: Run the test, then the whole index-related suite and the typecheck**

Run: `cd server && bun test test/index.properties.test.ts && bun test && cd .. && bun run typecheck`
Expected: all PASS. (A full server run takes about 90 s.)

- [ ] **Step 5: Commit**

```bash
git add server/src/index server/test/index.properties.test.ts
git commit -m "feat(index): keep each note's frontmatter as props, add ctime and propertyKeys" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 4: Type registry and GET /api/properties, PUT /api/properties/types

**Files:**
- Create: `server/src/properties/registry.ts`, `server/src/api/properties.ts`
- Modify: `server/src/app.ts`
- Test: `server/test/api.properties.test.ts`

**Interfaces:**
- Consumes: `VaultIndex.propertyKeys` (Task 3); `normalizeType`, `resolveType`, `PROPERTY_TYPES` (Task 2); `readFilterFor`, `requireOwner` from `server/src/api/perm-guard.ts`.
- Produces: `loadTypeOverrides(vault): Promise<Record<string, PropertyType>>`, `saveTypeOverride(vault, name, type): Promise<void>`, `listProperties(vault, index, allowed?): Promise<PropertyInfo[]>`, `propertyRoutes(vault, index)` (Elysia plugin, mounted in `app.ts`).

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h!: AppHandle;
let dir!: string;
let ownerToken!: string;
let apiKey!: string;

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await h.app.handle(new Request(`http://localhost${path}`, init));
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

async function put(path: string, content: string) {
  await h.vault.writeNote(path, content);
  await h.index.updatePath(path);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-api-props-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  await put("a.md", "---\nstatus: todo\nprio: 1\n---\n");
  await put("b.md", "---\nstatus: done\nprio: 2\n---\n");
  await put("secret/s.md", "---\nstatus: top\nclearance: 9\n---\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function lockDown() {
  await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
  await h.authStore.load();
  const login = await call("POST", "/api/auth/login", { password: "hunter2hunter2" });
  ownerToken = login.json.token;
  const key = await call("POST", "/api/auth/keys", { name: "agent" }, ownerToken);
  apiKey = key.json.token;
  await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: false }, ownerToken);
}

describe("GET /api/properties", () => {
  test("lists keys with counts, types and values", async () => {
    const r = await call("GET", "/api/properties");
    expect(r.status).toBe(200);
    const byName = Object.fromEntries((r.json as Array<{ name: string }>).map((i) => [i.name, i]));
    expect(byName.status).toMatchObject({ count: 3, type: "text" });
    expect(byName.prio).toMatchObject({ count: 2, type: "number", values: expect.arrayContaining([1, 2]) });
  });

  test("a type in .brain/types.json wins over inference; unknown strings read as text", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify({ types: { prio: "text", status: "from-the-future" } }));
    const r = await call("GET", "/api/properties");
    const byName = Object.fromEntries((r.json as Array<{ name: string; type: string }>).map((i) => [i.name, i]));
    expect(byName.prio!.type).toBe("text");
    expect(byName.status!.type).toBe("text");
  });

  test(".obsidian/types.json fills in keys brain.md has no entry for; brain.md wins on conflict", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    await mkdir(join(dir, ".obsidian"), { recursive: true });
    await writeFile(join(dir, ".obsidian/types.json"), JSON.stringify({ types: { prio: "multitext", status: "multitext" } }));
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify({ types: { status: "text" } }));
    const r = await call("GET", "/api/properties");
    const byName = Object.fromEntries((r.json as Array<{ name: string; type: string }>).map((i) => [i.name, i]));
    expect(byName.prio!.type).toBe("multitext");
    expect(byName.status!.type).toBe("text");
  });

  test("tags and aliases keep their fixed type whatever the registry says", async () => {
    await put("t.md", "---\ntags: [x]\naliases: [y]\n---\n");
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify({ types: { tags: "text", aliases: "text" } }));
    const r = await call("GET", "/api/properties");
    const byName = Object.fromEntries((r.json as Array<{ name: string; type: string }>).map((i) => [i.name, i]));
    expect(byName.tags!.type).toBe("tags");
    expect(byName.aliases!.type).toBe("aliases");
  });

  test("a key used only in an unreadable folder is not listed, and its values do not leak", async () => {
    await lockDown();
    const owner = await call("GET", "/api/properties", undefined, ownerToken);
    expect(JSON.stringify(owner.json)).toContain("clearance");
    const agent = await call("GET", "/api/properties", undefined, apiKey);
    expect(agent.status).toBe(200);
    expect(JSON.stringify(agent.json)).not.toContain("clearance");
    expect(JSON.stringify(agent.json)).not.toContain("top");
  });
});

describe("PUT /api/properties/types", () => {
  test("writes .brain/types.json in Obsidian's shape and GET reflects it", async () => {
    const r = await call("PUT", "/api/properties/types", { name: "prio", type: "text" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    const file = JSON.parse(await readFile(join(dir, ".brain/types.json"), "utf8"));
    expect(file).toEqual({ types: { prio: "text" } });
    const list = await call("GET", "/api/properties");
    expect((list.json as Array<{ name: string; type: string }>).find((i) => i.name === "prio")!.type).toBe("text");
  });

  test("keeps entries it does not understand and entries for other keys", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify({ types: { old: "future-type" } }));
    await call("PUT", "/api/properties/types", { name: "prio", type: "number" });
    const file = JSON.parse(await readFile(join(dir, ".brain/types.json"), "utf8"));
    expect(file).toEqual({ types: { old: "future-type", prio: "number" } });
  });

  test("a corrupt types file is not overwritten", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/types.json"), "{ not json");
    const r = await call("PUT", "/api/properties/types", { name: "prio", type: "number" });
    expect(r.status).toBe(500);
    expect(await readFile(join(dir, ".brain/types.json"), "utf8")).toBe("{ not json");
  });

  test("rejects an unknown type, an empty name and __proto__", async () => {
    expect((await call("PUT", "/api/properties/types", { name: "x", type: "bogus" })).status).toBe(422);
    expect((await call("PUT", "/api/properties/types", { name: "", type: "text" })).status).toBe(422);
    expect((await call("PUT", "/api/properties/types", { name: "__proto__", type: "text" })).status).toBe(400);
  });

  test("an API key cannot change types; the owner can", async () => {
    await lockDown();
    const denied = await call("PUT", "/api/properties/types", { name: "prio", type: "text" }, apiKey);
    expect(denied.status).toBe(403);
    const ok = await call("PUT", "/api/properties/types", { name: "prio", type: "text" }, ownerToken);
    expect(ok.status).toBe(200);
  });

  test("concurrent changes to different keys both land", async () => {
    await Promise.all([
      call("PUT", "/api/properties/types", { name: "a", type: "text" }),
      call("PUT", "/api/properties/types", { name: "b", type: "number" }),
      call("PUT", "/api/properties/types", { name: "c", type: "date" }),
    ]);
    const file = JSON.parse(await readFile(join(dir, ".brain/types.json"), "utf8"));
    expect(file.types).toEqual({ a: "text", b: "number", c: "date" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && bun test test/api.properties.test.ts`
Expected: FAIL (404 on `/api/properties`).

- [ ] **Step 3: Write the registry**

`server/src/properties/registry.ts`:

```ts
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeType, resolveType, type PropertyInfo, type PropertyType, type TypesFile } from "@brainmd/shared/property-types";
import type { VaultIndex } from "../index/index";
import { atomicWrite } from "../vault/atomic-write";
import { assertRealContainment } from "../vault/paths";
import type { Vault } from "../vault/vault";

const OWN_REL = ".brain/types.json";
const OBSIDIAN_REL = ".obsidian/types.json";

async function readTypesFile(vault: Vault, rel: string): Promise<Record<string, string> | null> {
  const abs = vault.abs(rel);
  await assertRealContainment(vault.root, abs);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return null;
    throw e;
  }
  const parsed = JSON.parse(raw) as Partial<TypesFile> | null;
  const types = parsed?.types;
  const out: Record<string, string> = {};
  if (!types || typeof types !== "object" || Array.isArray(types)) return out;
  for (const [name, type] of Object.entries(types)) {
    if (typeof type === "string" && name !== "__proto__") out[name] = type;
  }
  return out;
}

async function readTypesLenient(vault: Vault, rel: string): Promise<Record<string, string>> {
  try {
    return (await readTypesFile(vault, rel)) ?? {};
  } catch {
    return {};
  }
}

// brain.md's own file wins; `.obsidian/types.json` only fills in keys it has
// no entry for. An unknown type string reads as text.
export async function loadTypeOverrides(vault: Vault): Promise<Record<string, PropertyType>> {
  const [own, obsidian] = await Promise.all([
    readTypesLenient(vault, OWN_REL),
    readTypesLenient(vault, OBSIDIAN_REL),
  ]);
  const out: Record<string, PropertyType> = {};
  for (const [name, type] of Object.entries({ ...obsidian, ...own })) out[name] = normalizeType(type);
  return out;
}

let writeQueue: Promise<unknown> = Promise.resolve();

// Read-modify-write of .brain/types.json. Entries this version does not
// understand are written back unchanged. A file that exists but is not valid
// JSON stops the write instead of being replaced.
export function saveTypeOverride(vault: Vault, name: string, type: PropertyType): Promise<void> {
  const run = writeQueue.then(async () => {
    const types = (await readTypesFile(vault, OWN_REL)) ?? {};
    types[name] = type;
    const abs = vault.abs(OWN_REL);
    await mkdir(dirname(abs), { recursive: true });
    await atomicWrite(abs, `${JSON.stringify({ types }, null, 2)}\n`);
  });
  writeQueue = run.catch(() => {});
  return run;
}

export async function listProperties(
  vault: Vault,
  index: VaultIndex,
  allowed?: (path: string) => boolean,
): Promise<PropertyInfo[]> {
  const overrides = await loadTypeOverrides(vault);
  return index.propertyKeys(allowed).map((info) => ({
    ...info,
    type: resolveType(info.name, Object.hasOwn(overrides, info.name) ? overrides[info.name] : undefined, info.type),
  }));
}
```

- [ ] **Step 4: Write the routes and mount them**

`server/src/api/properties.ts` (Task 5 adds the `PATCH` route to this file):

```ts
import { Elysia, t } from "elysia";
import { PROPERTY_TYPES } from "@brainmd/shared/property-types";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { listProperties, saveTypeOverride } from "../properties/registry";
import { asError } from "./errors";
import { readFilterFor, requireOwner } from "./perm-guard";

export function propertyRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia()
    .get("/api/properties", async ({ request }) => {
      const allowed = await readFilterFor(vault, request);
      return listProperties(vault, index, allowed);
    })
    .put(
      "/api/properties/types",
      async ({ body, set, request }) => {
        try {
          requireOwner(request);
          if (body.name === "__proto__") {
            set.status = 400;
            return { error: "invalid property name", code: "INVALID_NAME" };
          }
          await saveTypeOverride(vault, body.name, body.type);
          return { ok: true };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 200 }),
          type: t.Union(PROPERTY_TYPES.map((p) => t.Literal(p))),
        }),
      },
    );
}
```

Apply this diff to `server/src/app.ts`:

```diff
--- a/server/src/app.ts
+++ b/server/src/app.ts
@@ -23,6 +23,7 @@
 import { trashRoutes } from "./api/trash";
 import { tasksRoutes } from "./api/tasks";
 import { tagRoutes } from "./api/tags";
+import { propertyRoutes } from "./api/properties";
 import { gitRoutes } from "./api/git";
 import { metaRoutes } from "./api/meta";
 import { settingsRoutes } from "./api/settings";
@@ -194,6 +195,7 @@
     .use(trashRoutes(vault, index))
     .use(tasksRoutes(vault, index))
     .use(tagRoutes(vault, index))
+    .use(propertyRoutes(vault, index))
     .use(gitRoutes(vault, repo, autocommit, settings, (p) => visibility.isHidden(p)))
     .use(metaRoutes(vault))
     .use(settingsRoutes(settings, autocommit, ragPipeline))
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `cd server && bun test test/api.properties.test.ts && cd .. && bun run typecheck`
Expected: PASS (11 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/properties/registry.ts server/src/api/properties.ts server/src/app.ts server/test/api.properties.test.ts
git commit -m "feat(api): GET /api/properties and PUT /api/properties/types with a type registry" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 5: updateProperties and PATCH /api/note-properties/*

**Files:**
- Create: `server/src/properties/update.ts`
- Modify: `server/src/api/properties.ts`, `server/src/vault/types.ts`, `server/src/api/errors.ts`
- Test: `server/test/api.note-properties.test.ts`

**Interfaces:**
- Consumes: `setProperties`, `FrontmatterError` (Task 1); `vault.mutateNote`, `NoteConflictError`, `sha256Hex` from `server/src/vault/vault.ts`; `propertyRoutes` (Task 4).
- Produces: `updateProperties(vault: Vault, path: string, input: { set?: Record<string, unknown>; unset?: string[]; baseRevision?: string }, canRead: boolean): Promise<NoteData>` (throws `VaultError` `NOT_FOUND` / `INVALID_VALUE`, `NoteConflictError`, `FrontmatterError`; returns the current note, unwritten, when nothing changed). Route `PATCH /api/note-properties/*` returning `{ path, mtime, revision? }`, 409 `{ code: "CONFLICT", revision }`, 422 `{ code, error }`. `VaultError` code `"INVALID_VALUE"` (HTTP 400).

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h!: AppHandle;
let dir!: string;
let ownerToken!: string;
let apiKey!: string;

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await h.app.handle(new Request(`http://localhost${path}`, init));
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

const read = (p: string) => readFile(join(dir, p), "utf8");

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-note-props-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  await h.vault.writeNote("a.md", "---\n# keep me\nid: 007\nstatus:   todo   # why\ntags:\n- x\n- y\n---\n\n# A\n");
  await h.vault.writeNote("plain.md", "# plain\n");
  await h.vault.writeNote("bad.md", "---\na: [1\n---\nbody\n");
  await h.vault.writeNote("secret/s.md", "---\nk: v\n---\nbody\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PATCH /api/note-properties/*", () => {
  test("sets and unsets, touching only the changed lines", async () => {
    const r = await call("PATCH", "/api/note-properties/a.md", { set: { status: "done", due: "2026-12-01" }, unset: ["id"] });
    expect(r.status).toBe(200);
    expect(r.json.path).toBe("a.md");
    expect(r.json.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(await read("a.md")).toBe("---\n# keep me\nstatus:   done   # why\ntags:\n- x\n- y\ndue: 2026-12-01\n---\n\n# A\n");
  });

  test("the edit is a normal write: the index sees it", async () => {
    await call("PATCH", "/api/note-properties/a.md", { set: { status: "done" } });
    expect(h.index.get("a.md")!.props.status).toBe("done");
  });

  test("creates a frontmatter block on a note without one", async () => {
    await call("PATCH", "/api/note-properties/plain.md", { set: { status: "new" } });
    expect(await read("plain.md")).toBe("---\nstatus: new\n---\n# plain\n");
  });

  test("a matching baseRevision succeeds, a stale one is 409 with the current revision", async () => {
    const note = (await call("GET", "/api/note/a.md")).json;
    const ok = await call("PATCH", "/api/note-properties/a.md", { set: { status: "x" }, baseRevision: note.revision });
    expect(ok.status).toBe(200);
    const stale = await call("PATCH", "/api/note-properties/a.md", { set: { status: "y" }, baseRevision: note.revision });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("CONFLICT");
    expect(stale.json.revision).toBe(ok.json.revision);
    expect((await read("a.md"))).toContain("status:   x   # why");
  });

  test("invalid YAML is 422 INVALID_YAML and the note is untouched", async () => {
    const before = await read("bad.md");
    const r = await call("PATCH", "/api/note-properties/bad.md", { set: { a: 1 } });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("INVALID_YAML");
    expect(await read("bad.md")).toBe(before);
  });

  test("a frontmatter that is a list is 422 NOT_A_MAPPING", async () => {
    await h.vault.writeNote("list.md", "---\n- a\n- b\n---\nbody\n");
    const r = await call("PATCH", "/api/note-properties/list.md", { set: { a: 1 } });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("NOT_A_MAPPING");
  });

  test("missing note is 404 and nothing is created", async () => {
    const r = await call("PATCH", "/api/note-properties/nope.md", { set: { a: 1 } });
    expect(r.status).toBe(404);
    expect((await call("GET", "/api/note/nope.md")).status).toBe(404);
  });

  test("a no-op edit writes nothing", async () => {
    const before = await h.vault.readNote("a.md");
    const r = await call("PATCH", "/api/note-properties/a.md", { set: { status: "todo" } });
    expect(r.status).toBe(200);
    expect((await h.vault.readNote("a.md")).mtime).toBe(before.mtime);
  });

  test("bad input: nothing to do, __proto__, too many keys, non-md path", async () => {
    expect((await call("PATCH", "/api/note-properties/a.md", {})).status).toBe(400);
    expect((await call("PATCH", "/api/note-properties/a.md", { set: JSON.parse('{"__proto__": 1}') })).status).toBe(400);
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i]));
    expect((await call("PATCH", "/api/note-properties/a.md", { set: many })).status).toBe(400);
    expect((await call("PATCH", "/api/note-properties/a.txt", { set: { a: 1 } })).status).toBe(400);
  });

  test("concurrent edits to different keys both land", async () => {
    await Promise.all([
      call("PATCH", "/api/note-properties/a.md", { set: { one: 1 } }),
      call("PATCH", "/api/note-properties/a.md", { set: { two: 2 } }),
      call("PATCH", "/api/note-properties/a.md", { set: { three: 3 } }),
    ]);
    expect(h.index.get("a.md")!.props).toMatchObject({ one: 1, two: 2, three: 3 });
  });
});

describe("PATCH /api/note-properties permissions", () => {
  beforeEach(async () => {
    await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
    await h.authStore.load();
    const login = await call("POST", "/api/auth/login", { password: "hunter2hunter2" });
    ownerToken = login.json.token;
    apiKey = (await call("POST", "/api/auth/keys", { name: "agent" }, ownerToken)).json.token;
    await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: false }, ownerToken);
    await call("POST", "/api/folder-mcp-perms", { path: "dropbox", read: false, write: true }, ownerToken);
    await h.vault.writeNote("dropbox/d.md", "---\nk: v\n---\nbody\n");
  });

  test("a denied folder is 403 for an API key and fine for the owner", async () => {
    expect((await call("PATCH", "/api/note-properties/secret/s.md", { set: { a: 1 } }, apiKey)).status).toBe(403);
    expect((await call("PATCH", "/api/note-properties/secret/s.md", { set: { a: 1 } }, ownerToken)).status).toBe(200);
  });

  test("a write-only folder: the edit works, but no revision comes back and base_revision is refused", async () => {
    const ok = await call("PATCH", "/api/note-properties/dropbox/d.md", { set: { a: 1 } }, apiKey);
    expect(ok.status).toBe(200);
    expect(ok.json.revision).toBeUndefined();
    const guarded = await call("PATCH", "/api/note-properties/dropbox/d.md", { set: { a: 2 }, baseRevision: "x" }, apiKey);
    expect(guarded.status).toBe(403);
  });

  test("a write-only caller gets a generic YAML error, not a quote of the source", async () => {
    await h.vault.writeNote("dropbox/bad.md", "---\nsecretword: [1\n---\n");
    const r = await call("PATCH", "/api/note-properties/dropbox/bad.md", { set: { a: 1 } }, apiKey);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json)).not.toContain("secretword");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && bun test test/api.note-properties.test.ts`
Expected: FAIL (404 on PATCH).

- [ ] **Step 3: Write `updateProperties`**

The edit runs inside `vault.mutateNote`, under the note's lock, so two concurrent edits queue instead of one overwriting the other.

`server/src/properties/update.ts`:

```ts
import { FrontmatterError, setProperties, type PropValue } from "@brainmd/shared/frontmatter";
import { VaultError, type NoteData } from "../vault/types";
import { NoteConflictError, sha256Hex, type Vault } from "../vault/vault";

const MAX_KEYS = 100;
const MAX_NAME = 200;
const MAX_DEPTH = 8;
const MAX_ITEMS = 1000;

export interface UpdatePropertiesInput {
  set?: Record<string, unknown>;
  unset?: string[];
  baseRevision?: string;
}

function checkName(name: string): void {
  if (name === "" || name.length > MAX_NAME || name === "__proto__" || /[\r\n]/.test(name)) {
    throw new VaultError(`invalid property name: ${JSON.stringify(name.slice(0, 40))}`, "INVALID_VALUE");
  }
}

function checkValue(v: unknown, depth = 0): PropValue {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (depth >= MAX_DEPTH) throw new VaultError("property value is nested too deeply", "INVALID_VALUE");
  if (Array.isArray(v)) {
    if (v.length > MAX_ITEMS) throw new VaultError("property list is too long", "INVALID_VALUE");
    return v.map((x) => checkValue(x, depth + 1));
  }
  if (typeof v === "object") {
    const out: Record<string, PropValue> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      checkName(k);
      out[k] = checkValue(x, depth + 1);
    }
    return out;
  }
  throw new VaultError("property values must be JSON: string, number, boolean, null, list or map", "INVALID_VALUE");
}

// The one write path for property edits, shared by PATCH /api/note-properties
// and the update_properties MCP tool. It edits under the note's write lock,
// so concurrent writers queue instead of losing each other's change.
// `canRead` is false for a write-only caller: YAML errors quote the source,
// so their message is replaced by a generic one.
export async function updateProperties(
  vault: Vault,
  path: string,
  input: UpdatePropertiesInput,
  canRead: boolean,
): Promise<NoteData> {
  const set: Record<string, PropValue> = {};
  for (const [name, value] of Object.entries(input.set ?? {})) {
    checkName(name);
    set[name] = checkValue(value);
  }
  const unset = input.unset ?? [];
  for (const name of unset) checkName(name);
  if (Object.keys(set).length + unset.length > MAX_KEYS) {
    throw new VaultError(`too many properties in one call (max ${MAX_KEYS})`, "INVALID_VALUE");
  }
  if (Object.keys(set).length === 0 && unset.length === 0) {
    throw new VaultError("nothing to update: pass set or unset", "INVALID_VALUE");
  }

  const written = await vault.mutateNote(path, (current) => {
    if (current === null) throw new VaultError(`note not found: ${path}`, "NOT_FOUND");
    if (input.baseRevision !== undefined) {
      const revision = sha256Hex(current);
      if (revision !== input.baseRevision) throw new NoteConflictError(path, revision);
    }
    try {
      const next = setProperties(current, set, unset);
      return next === current ? null : next;
    } catch (e) {
      if (e instanceof FrontmatterError && !canRead) {
        throw new FrontmatterError(e.code, "frontmatter is not valid YAML");
      }
      throw e;
    }
  });
  return written ?? vault.readNote(path);
}
```

- [ ] **Step 4: Add the error code and the route**

```diff
--- a/server/src/vault/types.ts
+++ b/server/src/vault/types.ts
@@ -27,6 +27,7 @@
       | "NOT_MARKDOWN"
       | "INVALID_PATH"
       | "INVALID_NAME"
+      | "INVALID_VALUE"
       | "EXISTS"
       | "FORBIDDEN"
       | "IO",
```

```diff
--- a/server/src/api/errors.ts
+++ b/server/src/api/errors.ts
@@ -5,6 +5,7 @@
     case "TRAVERSAL":
     case "INVALID_PATH":
     case "INVALID_NAME":
+    case "INVALID_VALUE":
     case "NOT_MARKDOWN":
       return 400;
     case "NOT_FOUND":
```

Apply this diff to `server/src/api/properties.ts` (it adds the `PATCH` route and its imports):

```diff
--- a/server/src/api/properties.ts
+++ b/server/src/api/properties.ts
@@ -1,10 +1,13 @@
 import { Elysia, t } from "elysia";
+import { FrontmatterError } from "@brainmd/shared/frontmatter";
 import { PROPERTY_TYPES } from "@brainmd/shared/property-types";
-import type { Vault } from "../vault/vault";
+import { NoteConflictError, type Vault } from "../vault/vault";
 import type { VaultIndex } from "../index/index";
 import { listProperties, saveTypeOverride } from "../properties/registry";
+import { updateProperties } from "../properties/update";
 import { asError } from "./errors";
-import { readFilterFor, requireOwner } from "./perm-guard";
+import { decodeWildcard } from "./wildcard";
+import { readFilterFor, requireOwner, requireRead, requireWrite } from "./perm-guard";
 
 export function propertyRoutes(vault: Vault, index: VaultIndex) {
   return new Elysia()
@@ -35,5 +38,44 @@
           type: t.Union(PROPERTY_TYPES.map((p) => t.Literal(p))),
         }),
       },
+    )
+    .patch(
+      "/api/note-properties/*",
+      async ({ params, body, set, request }) => {
+        const rel = decodeWildcard((params as { "*": string })["*"]);
+        try {
+          await requireWrite(vault, request, rel);
+          const canRead = (await readFilterFor(vault, request))(rel);
+          // A revision is only meaningful to someone who can read the note,
+          // and the conflict reply carries the current one.
+          if (body.baseRevision !== undefined) await requireRead(vault, request, rel);
+          const r = await updateProperties(
+            vault,
+            rel,
+            { set: body.set, unset: body.unset, baseRevision: body.baseRevision },
+            canRead,
+          );
+          return { path: r.path, mtime: r.mtime, ...(canRead ? { revision: r.revision } : {}) };
+        } catch (e) {
+          if (e instanceof NoteConflictError) {
+            set.status = 409;
+            return { code: "CONFLICT", revision: e.currentRevision };
+          }
+          if (e instanceof FrontmatterError) {
+            set.status = 422;
+            return { code: e.code, error: e.message };
+          }
+          const { status, body: err } = asError(e);
+          set.status = status;
+          return err;
+        }
+      },
+      {
+        body: t.Object({
+          set: t.Optional(t.Record(t.String(), t.Any())),
+          unset: t.Optional(t.Array(t.String())),
+          baseRevision: t.Optional(t.String()),
+        }),
+      },
     );
 }
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `cd server && bun test test/api.note-properties.test.ts test/api.properties.test.ts && cd .. && bun run typecheck`
Expected: PASS (13 + 11 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/src/properties/update.ts server/src/api server/src/vault/types.ts server/test/api.note-properties.test.ts
git commit -m "feat(api): PATCH /api/note-properties edits frontmatter through the vault write path" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 6: MCP update_properties, read_note.properties, docs and test matrix

**Files:**
- Modify: `server/src/mcp/server.ts`, `server/test/mcp.apps.test.ts`, `server/test/route-principal-matrix.test.ts`, `server/src/mcp/instructions.ts`, `mcp-prompt.md`, `docs/mcp.md`, `README.md`, `CHANGELOG.md`
- Test: `server/test/mcp.update-properties.test.ts`

**Interfaces:**
- Consumes: `updateProperties` (Task 5), `readFrontmatter` (Task 1), `checkWrite`, `checkRead`, `mayRead`, `readPerms`, `toolError`, `MODEL_ONLY_META` already in `server/src/mcp/server.ts`.
- Produces: MCP tool `update_properties { path: string; set?: Record<string, unknown>; unset?: string[]; base_revision?: string }` returning `{ ok: true, path, mtime, revision? }`; `read_note` result gains `properties: Record<string, PropValue> | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, type AppHandle } from "../src/app";

let h!: AppHandle;
let dir!: string;
let client!: Client;

async function connect(bearer?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      h.app.handle(new Request(input, init))) as unknown as typeof fetch,
    requestInit: bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {},
  });
  const c = new Client({ name: "test", version: "0.0.0" });
  await c.connect(transport);
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown>) {
  const r = await c.callTool({ name, arguments: args });
  return { isError: !!r.isError, body: JSON.parse((r.content as Array<{ text: string }>)[0]!.text) };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-props-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  await h.vault.writeNote("plan.md", "---\n# keep\nstatus: todo\ntags: [a]\n---\n\n# Plan\n");
  await h.vault.writeNote("plain.md", "# plain\n");
  await h.vault.writeNote("bad.md", "---\na: [1\n---\n");
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("read_note properties", () => {
  test("returns the parsed mapping next to content and revision", async () => {
    const r = await call(client, "read_note", { path: "plan.md" });
    expect(r.body.properties).toEqual({ status: "todo", tags: ["a"] });
    expect(r.body.content).toContain("# Plan");
    expect(r.body.revision).toMatch(/^[0-9a-f]{64}$/);
  });

  test("null without frontmatter and for invalid YAML", async () => {
    expect((await call(client, "read_note", { path: "plain.md" })).body.properties).toBeNull();
    expect((await call(client, "read_note", { path: "bad.md" })).body.properties).toBeNull();
  });
});

describe("update_properties", () => {
  test("is listed as a model-only write tool with annotations", async () => {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === "update_properties")!;
    expect(t.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true, openWorldHint: false });
    expect(t._meta?.ui).toEqual({ visibility: ["model"] });
  });

  test("sets and unsets, leaving comments and other lines alone", async () => {
    const r = await call(client, "update_properties", { path: "plan.md", set: { status: "done", prio: 2 }, unset: ["tags"] });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ ok: true, path: "plan.md" });
    expect(await readFile(join(dir, "plan.md"), "utf8")).toBe("---\n# keep\nstatus: done\nprio: 2\n---\n\n# Plan\n");
  });

  test("base_revision: the revision from read_note works once, then a stale one is CONFLICT", async () => {
    const rev = (await call(client, "read_note", { path: "plan.md" })).body.revision as string;
    const ok = await call(client, "update_properties", { path: "plan.md", set: { status: "a" }, base_revision: rev });
    expect(ok.isError).toBe(false);
    const stale = await call(client, "update_properties", { path: "plan.md", set: { status: "b" }, base_revision: rev });
    expect(stale.isError).toBe(true);
    expect(stale.body.code).toBe("CONFLICT");
    expect(stale.body.current_revision).toBe(ok.body.revision);
  });

  test("errors carry a code: INVALID_YAML, NOT_FOUND, nothing to do", async () => {
    expect((await call(client, "update_properties", { path: "bad.md", set: { a: 1 } })).body.code).toBe("INVALID_YAML");
    expect((await call(client, "update_properties", { path: "nope.md", set: { a: 1 } })).body.code).toBe("NOT_FOUND");
    expect((await call(client, "update_properties", { path: "plan.md" })).body.code).toBe("INVALID_VALUE");
  });
});

describe("update_properties permissions", () => {
  test("an API key is held to folder permissions; a write-only folder gets no revision back", async () => {
    await h.vault.writeNote("secret/s.md", "---\nk: v\n---\n");
    await h.vault.writeNote("dropbox/d.md", "---\nk: v\n---\n");
    const login = await h.app.handle(new Request("http://localhost/api/auth/set", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newPassword: "hunter2hunter2" }) }));
    expect(login.status).toBe(200);
    await h.authStore.load();
    const post = async (path: string, body: unknown, bearer?: string) => {
      const r = await h.app.handle(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }));
      return r.json() as Promise<any>;
    };
    const owner = (await post("/api/auth/login", { password: "hunter2hunter2" })).token as string;
    const key = (await post("/api/auth/keys", { name: "agent" }, owner)).token as string;
    await post("/api/folder-mcp-perms", { path: "secret", read: false, write: false }, owner);
    await post("/api/folder-mcp-perms", { path: "dropbox", read: false, write: true }, owner);

    const agent = await connect(key);
    const denied = await call(agent, "update_properties", { path: "secret/s.md", set: { a: 1 } });
    expect(denied.isError).toBe(true);
    expect(denied.body.code).toBe("MCP_WRITE_DENIED");
    const blind = await call(agent, "update_properties", { path: "dropbox/d.md", set: { a: 1 } });
    expect(blind.isError).toBe(false);
    expect(blind.body.revision).toBeUndefined();
    const guarded = await call(agent, "update_properties", { path: "dropbox/d.md", set: { a: 2 }, base_revision: "x" });
    expect(guarded.body.code).toBe("MCP_READ_DENIED");
    await agent.close();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && bun test test/mcp.update-properties.test.ts`
Expected: FAIL (`properties` undefined; tool not found).

- [ ] **Step 3: Add the tool and the `read_note` field**

`server/src/mcp/server.ts` starts with `@ts-nocheck`, so the typecheck will not catch mistakes here; the tests do.

```diff
--- a/server/src/mcp/server.ts
+++ b/server/src/mcp/server.ts
@@ -27,6 +27,8 @@
 } from "../api/principal";
 import { principalFor } from "../api/auth-middleware";
 import { loadMcpInstructions } from "./instructions";
+import { readFrontmatter } from "@brainmd/shared/frontmatter";
+import { updateProperties } from "../properties/update";
 import { buildGraph, graphSummary, neighbourhood } from "../index/graph";
 import {
   MODEL_ONLY_META,
@@ -77,6 +79,16 @@
   readOnlyHint: false,
   destructiveHint: false,
   idempotentHint: false,
+  openWorldHint: false,
+} as const;
+
+// Same value twice gives the same note, and an unchanged note is not
+// rewritten, so a repeat is idempotent. Overwriting a value is still
+// destructive in MCP's terms.
+const UPDATE_PROPERTIES_ANNOTATIONS = {
+  readOnlyHint: false,
+  destructiveHint: true,
+  idempotentHint: true,
   openWorldHint: false,
 } as const;
 
@@ -317,7 +329,9 @@
     "read_note",
     {
       annotations: READ_ONLY_LOCAL,
-      description: "Read a single note. Returns content + mtime.",
+      description:
+        "Read a single note. Returns content, mtime, revision and `properties`: the parsed frontmatter " +
+        "mapping (null when the note has no frontmatter or it is not valid YAML).",
       inputSchema: { path: z.string().min(1) },
       ...noteToolMeta(views),
     },
@@ -326,7 +340,9 @@
         await checkRead(vault, principal, path);
         const note = await vault.readNote(path);
         logCall("read_note", { path }, true);
-        const result = { content: [{ type: "text", text: JSON.stringify(note) }] };
+        const result = {
+          content: [{ type: "text", text: JSON.stringify({ ...note, properties: readFrontmatter(note.content).props }) }],
+        };
         if (!views.note) return result;
         return { ...result, _meta: { [NOTE_VIEW_META_KEY]: noteViewData(index, note.path, await readFilter()) } };
       } catch (err) {
@@ -550,6 +566,44 @@
         return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...r }) }] };
       } catch (err) {
         return toolError("write_note", { path, bytes: content.length }, err);
+      }
+    },
+  );
+
+  server.registerTool(
+    "update_properties",
+    {
+      annotations: UPDATE_PROPERTIES_ANNOTATIONS,
+      description:
+        "Change frontmatter properties of an existing note without rewriting it. `set` maps names to new " +
+        "values (string, number, boolean, null, list or map; a new name is added, an existing one replaced) " +
+        "and `unset` lists names to remove. Only the touched lines change: comments, key order and the " +
+        "other properties stay as they are. Fails with INVALID_YAML if the note's frontmatter does not " +
+        "parse. Pass base_revision (from read_note) to refuse the edit if the note changed since; you " +
+        "then get code CONFLICT with the current revision.",
+      ...MODEL_ONLY_META,
+      inputSchema: {
+        path: z.string().min(1),
+        set: z.record(z.string(), z.unknown()).optional(),
+        unset: z.array(z.string()).optional(),
+        base_revision: z.string().min(1).optional(),
+      },
+    },
+    async ({ path, set, unset, base_revision }) => {
+      try {
+        await checkWrite(vault, principal, path);
+        // A revision, or a YAML error quoting the source, is only for callers who can read the note.
+        if (base_revision !== undefined) await checkRead(vault, principal, path);
+        const canRead = await mayRead(principal, path, await readPerms(vault));
+        const r = await updateProperties(vault, path, { set, unset, baseRevision: base_revision }, canRead);
+        logCall("update_properties", { path, set: Object.keys(set ?? {}), unset }, true);
+        return {
+          content: [
+            { type: "text", text: JSON.stringify({ ok: true, path: r.path, mtime: r.mtime, ...(canRead ? { revision: r.revision } : {}) }) },
+          ],
+        };
+      } catch (err) {
+        return toolError("update_properties", { path }, err);
       }
     },
   );
```

- [ ] **Step 4: Update the two existing tests that enumerate tools and routes**

`mcp.apps.test.ts` lists the write tools; the matrix test wants a row for every route and tool. The matrix fixture note `secret/a.md` gets a frontmatter key so `GET /api/properties` has something for the owner to see and an API key not to.

```diff
--- a/server/test/mcp.apps.test.ts
+++ b/server/test/mcp.apps.test.ts
@@ -91,18 +91,19 @@
 });
 
 describe("MCP tool annotations", () => {
-  test("every tool is annotated; only write_note and append_note write", async () => {
+  test("every tool is annotated; only write_note, append_note and update_properties write", async () => {
     const { c } = await client(false);
     const { tools } = await c.listTools();
     expect(tools.length).toBeGreaterThan(0);
     for (const t of tools) {
       expect(t.annotations).toBeDefined();
-      const writes = t.name === "write_note" || t.name === "append_note";
+      const writes = ["write_note", "append_note", "update_properties"].includes(t.name);
       expect(t.annotations?.readOnlyHint).toBe(!writes);
     }
     const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
     expect(byName.write_note).toMatchObject({ destructiveHint: true, idempotentHint: false });
     expect(byName.append_note).toMatchObject({ destructiveHint: false, idempotentHint: false });
+    expect(byName.update_properties).toMatchObject({ destructiveHint: true, idempotentHint: true });
   });
 });
 
```

```diff
--- a/server/test/route-principal-matrix.test.ts
+++ b/server/test/route-principal-matrix.test.ts
@@ -88,7 +88,7 @@
   openHandles.push(handle);
   await handle.repo.ensure();
 
-  await handle.vault.writeNote("secret/a.md", "top secret body\n- [ ] secret task\n#secrettag\n");
+  await handle.vault.writeNote("secret/a.md", "---\nlevel: secret\n---\ntop secret body\n- [ ] secret task\n#secrettag\n");
   await handle.vault.writeNote("public/b.md", "public body\n- [ ] public task\n");
   await handle.vault.writeMedia("secret/a.md", "pic.png", new Uint8Array([1, 2, 3]));
   await handle.index.updatePath("secret/a.md");
@@ -143,6 +143,7 @@
   { name: "GET /api/settings", class: "admin", exec: (f) => call(f.handle, "GET", "/api/settings", undefined, f.bearer) },
   { name: "PATCH /api/settings", class: "admin", exec: (f) => call(f.handle, "PATCH", "/api/settings", {}, f.bearer) },
   { name: "GET /api/folder-mcp-perms", class: "admin", exec: (f) => call(f.handle, "GET", "/api/folder-mcp-perms", undefined, f.bearer) },
+  { name: "PUT /api/properties/types", class: "admin", exec: (f) => call(f.handle, "PUT", "/api/properties/types", { name: "level", type: "text" }, f.bearer) },
   { name: "POST /api/folder-mcp-perms", class: "admin", exec: (f) => call(f.handle, "POST", "/api/folder-mcp-perms", { path: "public", read: true, write: true }, f.bearer) },
   { name: "DELETE /api/folder-mcp-perms/public", class: "admin", exec: (f) => call(f.handle, "DELETE", "/api/folder-mcp-perms/public", undefined, f.bearer) },
   { name: "GET /api/auth/keys", class: "admin", exec: (f) => call(f.handle, "GET", "/api/auth/keys", undefined, f.bearer) },
@@ -178,6 +179,7 @@
   { name: "PUT /api/note/secret/a.md", class: "strict", exec: (f) => call(f.handle, "PUT", "/api/note/secret/a.md", { content: "x" }, f.bearer) },
   { name: "DELETE /api/note/secret/a.md", class: "strict", exec: (f) => call(f.handle, "DELETE", "/api/note/secret/a.md", undefined, f.bearer) },
   { name: "GET /api/backlinks/secret/a.md", class: "strict", exec: (f) => call(f.handle, "GET", "/api/backlinks/secret/a.md", undefined, f.bearer) },
+  { name: "PATCH /api/note-properties/secret/a.md", class: "strict", exec: (f) => call(f.handle, "PATCH", "/api/note-properties/secret/a.md", { set: { level: "x" } }, f.bearer) },
   { name: "POST /api/rename", class: "strict", exec: (f) => call(f.handle, "POST", "/api/rename", { from: "secret/a.md", to: "secret/moved.md" }, f.bearer) },
   { name: "POST /api/folder/secret/newsub", class: "strict", exec: (f) => call(f.handle, "POST", "/api/folder/secret/newsub", undefined, f.bearer) },
   { name: "DELETE /api/folder/secret", class: "strict", exec: (f) => call(f.handle, "DELETE", "/api/folder/secret", undefined, f.bearer) },
@@ -197,6 +199,7 @@
   { name: "GET /api/tags", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/tags", undefined, f.bearer) },
   { name: "GET /api/tags/notes?tag=secrettag", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/tags/notes?tag=secrettag", undefined, f.bearer) },
   { name: "GET /api/resolve?name=a", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/resolve?name=a", undefined, f.bearer) },
+  { name: "GET /api/properties", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/properties", undefined, f.bearer) },
   { name: "GET /api/tasks", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/tasks", undefined, f.bearer) },
   { name: "GET /api/search?q=secret", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/search?q=secret", undefined, f.bearer) },
   { name: "GET /api/folder-meta", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/folder-meta", undefined, f.bearer) },
@@ -351,6 +354,16 @@
     expectError: deniedByFolder,
   },
   {
+    name: "update_properties secret/a.md (folder dimension)",
+    exec: (c) => callTool(c, "update_properties", { path: "secret/a.md", set: { level: "x" } }),
+    expectError: deniedByFolder,
+  },
+  {
+    name: "update_properties public/b.md (scope dimension)",
+    exec: (c) => callTool(c, "update_properties", { path: "public/b.md", set: { level: "x" } }),
+    expectError: (kind) => kind === "oauth-read",
+  },
+  {
     name: "read_note public/b.md (scope dimension)",
     exec: (c) => callTool(c, "read_note", { path: "public/b.md" }),
     expectError: (kind) => kind === "oauth-write",
```

- [ ] **Step 5: Docs and agent instructions (count 18 -> 19)**

1. `README.md`: in the feature table row "MCP server" change `18 tools and 2 resources` to `19 tools and 2 resources`. In the comparison table change `**✓ (18 tools)**` to `**✓ (19 tools)**`. Change `Tools (18):` to `Tools (19):`. Change the `read_note` row text `Note body + mtime` to ``Note body, mtime, parsed `properties` ``. After the `append_note` row add:

```
| `update_properties`   | `write`     | Change frontmatter properties (`set`, `unset`, `base_revision`)    |
```

In the paragraph "Every tool carries MCP annotations." change ``except `write_note` (overwrites: `destructiveHint`; not idempotent, a repeat still bumps mtime) and `append_note` (adds: neither destructive nor idempotent).`` to ``except `write_note` (overwrites: `destructiveHint`; not idempotent, a repeat still bumps mtime), `append_note` (adds: neither destructive nor idempotent) and `update_properties` (changes only the named frontmatter keys; destructive, idempotent).``

2. `docs/mcp.md`: change `## Tools (18)` to `## Tools (19)`. Change the `read_note` row to ``| `read_note`           | yes       | read        | Note body, mtime, revision, parsed `properties`; links the MCP Apps note view |``. After the `append_note` row add:

```
| `update_properties`   | no        | write       | Set or remove frontmatter keys without rewriting the note (`set`, `unset`, `base_revision`) |
```

In "### Annotations" add a bullet after the `append_note` one:

```
- `update_properties`: `readOnlyHint: false`, `destructiveHint: true`,
  `idempotentHint: true` (an unchanged note is not rewritten).
```

Add a section before `## Which agent made a change`:

````
## Changing properties

`read_note` returns `properties`, the parsed frontmatter (`null` when there is
none or it does not parse). `update_properties` changes keys without sending
the whole note, and only the touched lines change: comments, key order, list
style and line endings stay.

```jsonc
// update_properties:
{ "path": "work/plan.md", "set": { "status": "done", "due": "2026-12-01" }, "unset": ["draft"], "base_revision": "9f2c..." }
```

Values are strings, numbers, booleans, null, lists or maps. `base_revision`
works as for `write_note` (code `CONFLICT` with the current revision). A note
whose frontmatter does not parse fails with `INVALID_YAML`. A write-only
folder works but returns no revision.
````

3. `server/src/mcp/instructions.ts` and `mcp-prompt.md` (keep them identical; in the `.ts` file backticks are escaped as `\``): in section 1, after the bullet that ends "...need it. The reply says how many there are and which `offset` comes next." add a bullet:

```
- To change frontmatter (status, due date, tags, any property) call
  `update_properties` with `set` / `unset` instead of rewriting the note;
  `read_note` returns the parsed `properties`.
```

and in section 4 change the last bullet to:

```
- Keep edits small and intentional. Don't rewrite a whole note to change one
  line: `append_note`, `update_properties` for frontmatter, or a targeted
  `write_note` is usually right.
```

4. `CHANGELOG.md`: add above `## 0.9.0 - 2026-11-18`:

```
## Unreleased

### Added

- **Properties.** A Properties panel edits typed frontmatter as rows (type
  icon, name, value) with suggestions from keys used across the vault.
  Edits touch only the changed lines of the YAML. Types live in
  `.brain/types.json` (Obsidian's `types.json` shape; `.obsidian/types.json`
  is read as a fallback).
- **MCP `update_properties`** and `properties` in `read_note`: agents change
  a status without rewriting the note. `GET /api/properties`,
  `PUT /api/properties/types` and `PATCH /api/note-properties/*` back the UI.
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `cd server && bun test test/mcp.update-properties.test.ts test/mcp.apps.test.ts test/route-principal-matrix.test.ts test/mcp.instructions.test.ts && bun test && cd .. && bun run typecheck`
Expected: all PASS (the matrix takes about 50 s, the full run about 90 s).

- [ ] **Step 7: Commit**

```bash
git add server README.md docs/mcp.md mcp-prompt.md CHANGELOG.md
git commit -m "feat(mcp): update_properties and read_note properties" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 7: Web panel model and API client

**Files:**
- Create: `web/src/properties/model.ts`
- Modify: `web/src/api/client.ts`
- Test: `web/test/properties.model.test.ts`

**Interfaces:**
- Consumes: `readFrontmatter`, `setProperties`, `renameProperty`, `PropValue` (Task 1); `inferType`, `resolveType`, `DATE_RE`, `DATETIME_RE`, `PropertyInfo`, `PropertyType` (Task 2); `GET /api/properties`, `PUT /api/properties/types` (Task 4).
- Produces: `interface PropRow { name; value: PropValue; type: PropertyType; nested: boolean }`, `type PanelModel = { kind: "rows"; rows: PropRow[]; offset: number } | { kind: "error"; message: string; offset: number }`, `buildModel(content, infos)`, `editSet(name, value)`, `editUnset(name)`, `editRename(from, to)` (each returns `(current: string) => string`), `initialValue(type)`, `toList`, `cleanItem`, `listFor`, `parseNumber`, `textOf`, `nativeDate`, `nativeDateTime`, `minimalChange(before, after): { from; to; insert } | null`; `api.properties(): Promise<PropertyInfo[]>`, `api.setPropertyType(name, type): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { buildModel, cleanItem, editRename, editSet, editUnset, initialValue, listFor, minimalChange, nativeDate, nativeDateTime, parseNumber, toList } from "../src/properties/model";

const note = "---\ntitle: Hello\ntags: [a, b]\nstatus: todo\ndue: 2026-12-01\nnested:\n  k: 1\n---\n\n# Body\n";

describe("buildModel", () => {
  test("rows with types: registry wins, tags fixed, else inferred", () => {
    const m = buildModel(note, [{ name: "status", type: "text", count: 3, values: ["todo"] }, { name: "due", type: "datetime", count: 1, values: [] }]);
    expect(m.kind).toBe("rows");
    if (m.kind !== "rows") return;
    expect(m.offset).toBe(4);
    expect(m.rows.map((r) => [r.name, r.type, r.nested])).toEqual([
      ["title", "text", false], ["tags", "tags", false], ["status", "text", false], ["due", "datetime", false], ["nested", "text", true],
    ]);
  });
  test("no frontmatter gives no rows", () => {
    expect(buildModel("# x\n", [])).toEqual({ kind: "rows", rows: [], offset: 0 });
  });
  test("invalid yaml gives an error with an offset inside the block", () => {
    const m = buildModel("---\na: [1\n---\nx", []);
    expect(m.kind).toBe("error");
    if (m.kind === "error") expect(m.offset).toBe(4);
  });
});

describe("edits", () => {
  test("set, unset, rename touch only their key", () => {
    expect(editSet("status", "done")(note)).toContain("status: done\ndue: 2026-12-01");
    expect(editUnset("tags")(note)).not.toContain("tags");
    expect(editRename("status", "state")(note)).toContain("state: todo");
  });
  test("initial values", () => {
    expect(initialValue("tags")).toEqual([]);
    expect(initialValue("checkbox")).toBe(false);
    expect(initialValue("text")).toBeNull();
  });
});

describe("value helpers", () => {
  test("lists", () => {
    expect(toList(null)).toEqual([]);
    expect(toList("x")).toEqual(["x"]);
    expect(toList(["a", 1, null, { k: 1 }])).toEqual(["a", "1"]);
    expect(cleanItem("tags", " #my tag ")).toBe("my-tag");
    expect(listFor("tags", ["#a", "a", " ", "b"])).toEqual(["a", "b"]);
  });
  test("numbers and native dates", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber(" 4.5 ")).toBe(4.5);
    expect(nativeDate("2026-01-02")).toBe("2026-01-02");
    expect(nativeDate("next week")).toBeNull();
    expect(nativeDate(null)).toBe("");
    expect(nativeDateTime("2026-01-02T10:30:00Z")).toBe("2026-01-02T10:30");
    expect(nativeDateTime("2026-01-02")).toBeNull();
  });
});

describe("minimalChange", () => {
  test("replaces only the differing middle", () => {
    expect(minimalChange("abcXdef", "abcYYdef")).toEqual({ from: 3, to: 4, insert: "YY" });
    expect(minimalChange("same", "same")).toBeNull();
    expect(minimalChange("ab", "abc")).toEqual({ from: 2, to: 2, insert: "c" });
    const before = "---\na: 1\n---\nbody";
    const after = "---\na: 2\n---\nbody";
    const c = minimalChange(before, after)!;
    expect(before.slice(0, c.from) + c.insert + before.slice(c.to)).toBe(after);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd web && bun test test/properties.model.test.ts`
Expected: FAIL, cannot find module `../src/properties/model`.

- [ ] **Step 3: Write the model**

`offset` is where "Fix in source" and "edit in source" put the cursor. `minimalChange` turns the new text into one CodeMirror change over only the bytes that differ.

`web/src/properties/model.ts`:

```ts
import { readFrontmatter, renameProperty, setProperties, type PropValue } from "@brainmd/shared/frontmatter";
import {
  DATETIME_RE,
  DATE_RE,
  inferType,
  resolveType,
  type PropertyInfo,
  type PropertyType,
} from "@brainmd/shared/property-types";

export interface PropRow {
  name: string;
  value: PropValue;
  type: PropertyType;
  nested: boolean;
}

export type PanelModel =
  | { kind: "rows"; rows: PropRow[]; offset: number }
  | { kind: "error"; message: string; offset: number };

export function isNested(v: PropValue): boolean {
  if (Array.isArray(v)) return v.some((x) => typeof x === "object" && x !== null);
  return typeof v === "object" && v !== null;
}

// `infos` is GET /api/properties: its type per name already folds in the
// registry, so it only needs to win over inference from this one value.
// `offset` is where "edit in source" and "Fix in source" put the cursor:
// the first line after the opening `---`.
export function buildModel(content: string, infos: PropertyInfo[]): PanelModel {
  const fm = readFrontmatter(content);
  const offset = fm.range ? fm.range.from + 4 : 0;
  if (fm.error !== null) return { kind: "error", message: fm.error, offset };
  const known = new Map(infos.map((i) => [i.name, i.type]));
  const rows = Object.entries(fm.props ?? {}).map(([name, value]) => ({
    name,
    value,
    nested: isNested(value),
    type: resolveType(name, known.get(name), inferType([value])),
  }));
  return { kind: "rows", rows, offset };
}

export const editSet = (name: string, value: PropValue) => (c: string) => setProperties(c, { [name]: value });
export const editUnset = (name: string) => (c: string) => setProperties(c, {}, [name]);
export const editRename = (from: string, to: string) => (c: string) => renameProperty(c, from, to);

export function initialValue(type: PropertyType): PropValue {
  if (type === "multitext" || type === "tags" || type === "aliases") return [];
  if (type === "checkbox") return false;
  return null;
}

export function toList(v: PropValue): string[] {
  if (v === null) return [];
  if (Array.isArray(v)) return v.filter((x) => x !== null && typeof x !== "object").map((x) => String(x));
  if (typeof v === "object") return [];
  const s = String(v);
  return s === "" ? [] : [s];
}

export function cleanItem(type: PropertyType, raw: string): string {
  const t = raw.trim();
  return type === "tags" ? t.replace(/^#+/, "").replace(/\s+/g, "-") : t;
}

export function listFor(type: PropertyType, items: string[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const c = cleanItem(type, it);
    if (c !== "" && !out.includes(c)) out.push(c);
  }
  return out;
}

export function parseNumber(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function textOf(v: PropValue): string {
  return v === null || typeof v === "object" ? "" : String(v);
}

// Native date inputs need exact formats; anything else falls back to text so
// an unusual stored value is never silently dropped.
export function nativeDate(v: PropValue): string | null {
  if (v === null) return "";
  return typeof v === "string" && DATE_RE.test(v) ? v : null;
}

export function nativeDateTime(v: PropValue): string | null {
  if (v === null) return "";
  return typeof v === "string" && DATETIME_RE.test(v) ? v.slice(0, 16) : null;
}

export function minimalChange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let start = 0;
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--;
    endAfter--;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
```

- [ ] **Step 4: Add the client methods**

```diff
--- a/web/src/api/client.ts
+++ b/web/src/api/client.ts
@@ -9,6 +9,7 @@
   WriteNoteResult,
 } from "./types";
 
+import type { PropertyInfo, PropertyType } from "@brainmd/shared/property-types";
 import type { GraphInput } from "../graph/engine";
 
 const BASE = "";
@@ -120,6 +121,20 @@
   async graph(): Promise<GraphInput> {
     return jsonOrThrow(await fetch(`${BASE}/api/graph`));
   },
+  async properties(): Promise<PropertyInfo[]> {
+    return jsonOrThrow(await fetch(`${BASE}/api/properties`));
+  },
+  // Owner only. Changes how values of this name are edited vault-wide; no
+  // note is rewritten.
+  async setPropertyType(name: string, type: PropertyType): Promise<void> {
+    await jsonOrThrow<{ ok: true }>(
+      await fetch(`${BASE}/api/properties/types`, {
+        method: "PUT",
+        headers: { "content-type": "application/json" },
+        body: JSON.stringify({ name, type }),
+      }),
+    );
+  },
   async resolve(name: string): Promise<ResolveResult> {
     return jsonOrThrow(
       await fetch(`${BASE}/api/resolve?name=${encodeURIComponent(name)}`),
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `cd web && bun test && cd .. && bun run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/properties/model.ts web/src/api/client.ts web/test/properties.model.test.ts
git commit -m "feat(web): property panel model, edit functions and API client" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 8: Value editors, type button and icons

The web package has no component test setup, so this task is verified by the typecheck and the manual check in Task 10. The logic that can fail (coercion, lists, dates) is already covered by Task 7.

**Files:**
- Create: `web/src/properties/type-meta.tsx`, `web/src/properties/useProperties.ts`, `web/src/components/properties/ValueEditor.tsx`, `web/src/components/properties/TypeButton.tsx`
- Modify: `web/src/components/Icons.tsx`

**Interfaces:**
- Consumes: `PropRow`, `listFor`, `toList`, `textOf`, `parseNumber`, `nativeDate`, `nativeDateTime` (Task 7); `api.properties` (Task 7); `DropdownMenu*` from `web/src/components/ui/dropdown-menu.tsx`.
- Produces: `TYPE_META: Record<PropertyType, { label; Icon }>`, `CHOOSABLE_TYPES`, `useProperties(refreshKey: string): { infos: PropertyInfo[]; refresh: () => void }`, `<ValueEditor row suggestions onCommit onLeave onEditInSource />` (every focusable value control carries `data-prop-value`), `<TypeButton name type onPick />`, icons `TypeTextIcon`, `TypeListIcon`, `TypeNumberIcon`, `TypeClockIcon`, `TypeAliasIcon`, `CloseIcon`.

- [ ] **Step 1: Add the icons**

Apply to `web/src/components/Icons.tsx`:

```diff
--- a/web/src/components/Icons.tsx
+++ b/web/src/components/Icons.tsx
@@ -294,6 +294,67 @@
       <line x1="12" y1="10" x2="12" y2="14" />
       <line x1="10" y1="12" x2="14" y2="12" />
       <line x1="10" y1="17" x2="14" y2="17" />
+    </svg>
+  );
+}
+
+export function TypeTextIcon(p: SVGProps<SVGSVGElement>) {
+  return (
+    <svg {...baseProps} {...p}>
+      <line x1="4" y1="7" x2="20" y2="7" />
+      <line x1="4" y1="12" x2="20" y2="12" />
+      <line x1="4" y1="17" x2="13" y2="17" />
+    </svg>
+  );
+}
+
+export function TypeListIcon(p: SVGProps<SVGSVGElement>) {
+  return (
+    <svg {...baseProps} {...p}>
+      <line x1="9" y1="7" x2="20" y2="7" />
+      <line x1="9" y1="12" x2="20" y2="12" />
+      <line x1="9" y1="17" x2="20" y2="17" />
+      <circle cx="4.5" cy="7" r="0.8" />
+      <circle cx="4.5" cy="12" r="0.8" />
+      <circle cx="4.5" cy="17" r="0.8" />
     </svg>
   );
 }
+
+export function TypeNumberIcon(p: SVGProps<SVGSVGElement>) {
+  return (
+    <svg {...baseProps} {...p}>
+      <line x1="5" y1="9" x2="19" y2="9" />
+      <line x1="5" y1="15" x2="19" y2="15" />
+      <line x1="10" y1="4" x2="8" y2="20" />
+      <line x1="16" y1="4" x2="14" y2="20" />
+    </svg>
+  );
+}
+
+export function TypeClockIcon(p: SVGProps<SVGSVGElement>) {
+  return (
+    <svg {...baseProps} {...p}>
+      <circle cx="12" cy="12" r="9" />
+      <polyline points="12 7 12 12 15.5 14" />
+    </svg>
+  );
+}
+
+export function TypeAliasIcon(p: SVGProps<SVGSVGElement>) {
+  return (
+    <svg {...baseProps} {...p}>
+      <polyline points="15 10 20 15 15 20" />
+      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
+    </svg>
+  );
+}
+
+export function CloseIcon(p: SVGProps<SVGSVGElement>) {
+  return (
+    <svg {...baseProps} {...p}>
+      <line x1="6" y1="6" x2="18" y2="18" />
+      <line x1="18" y1="6" x2="6" y2="18" />
+    </svg>
+  );
+}
```

- [ ] **Step 2: Type metadata and the properties hook**

`web/src/properties/type-meta.tsx`:

```tsx
import type { ComponentType, SVGProps } from "react";
import type { PropertyType } from "@brainmd/shared/property-types";
import {
  CalendarIcon,
  CheckSquareIcon,
  TagIcon,
  TypeAliasIcon,
  TypeClockIcon,
  TypeListIcon,
  TypeNumberIcon,
  TypeTextIcon,
} from "../components/Icons";

interface TypeMeta {
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const TYPE_META: Record<PropertyType, TypeMeta> = {
  text: { label: "Text", Icon: TypeTextIcon },
  multitext: { label: "List", Icon: TypeListIcon },
  number: { label: "Number", Icon: TypeNumberIcon },
  checkbox: { label: "Checkbox", Icon: CheckSquareIcon },
  date: { label: "Date", Icon: CalendarIcon },
  datetime: { label: "Date & time", Icon: TypeClockIcon },
  tags: { label: "Tags", Icon: TagIcon },
  aliases: { label: "Aliases", Icon: TypeAliasIcon },
};

// What a person can pick; tags and aliases are fixed by name.
export const CHOOSABLE_TYPES: PropertyType[] = ["text", "multitext", "number", "checkbox", "date", "datetime"];
```

`web/src/properties/useProperties.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { PropertyInfo } from "@brainmd/shared/property-types";
import { api } from "../api/client";

// Vault-wide property keys, types and common values. Reloads when
// `refreshKey` changes (the open note) and on demand.
export function useProperties(refreshKey: string): { infos: PropertyInfo[]; refresh: () => void } {
  const [infos, setInfos] = useState<PropertyInfo[]>([]);
  const refresh = useCallback(() => {
    api
      .properties()
      .then(setInfos)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh, refreshKey]);
  return { infos, refresh };
}
```

- [ ] **Step 3: Value editor**

Text and number inputs commit on blur or Enter and revert on Escape; dates and checkboxes commit on change; chips commit on Enter, comma, blur and remove. A value that a native date input cannot show (for example `next week`) falls back to a text input, so nothing is silently dropped. Nested values are read-only with an "edit in source" button.

`web/src/components/properties/ValueEditor.tsx`:

```tsx
import { useId } from "react";
import type { PropValue } from "@brainmd/shared/frontmatter";
import {
  listFor,
  nativeDate,
  nativeDateTime,
  parseNumber,
  textOf,
  toList,
  type PropRow,
} from "../../properties/model";
import { CloseIcon } from "../Icons";

interface Props {
  row: PropRow;
  // Values other notes use for this name, most common first.
  suggestions: PropValue[];
  onCommit: (value: PropValue) => void;
  // Escape: hand focus back to the row.
  onLeave: () => void;
  onEditInSource: () => void;
}

export function ValueEditor({ row, suggestions, onCommit, onLeave, onEditInSource }: Props) {
  const { type, value } = row;

  if (row.nested) {
    return (
      <div className="prop-nested">
        <code className="prop-nested-value">{JSON.stringify(value)}</code>
        <button type="button" className="prop-link" onClick={onEditInSource}>
          edit in source
        </button>
      </div>
    );
  }

  if (type === "checkbox") {
    return (
      <input
        data-prop-value
        className="prop-check"
        type="checkbox"
        aria-label={row.name}
        checked={value === true}
        onChange={(e) => onCommit(e.currentTarget.checked)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onLeave();
          }
        }}
      />
    );
  }

  if (type === "multitext" || type === "tags" || type === "aliases") {
    return (
      <Chips
        name={row.name}
        type={type}
        items={toList(value)}
        suggestions={suggestions}
        onCommit={onCommit}
        onLeave={onLeave}
      />
    );
  }

  if (type === "date" || type === "datetime") {
    const native = type === "date" ? nativeDate(value) : nativeDateTime(value);
    if (native !== null) {
      return (
        <input
          data-prop-value
          className="prop-input prop-mono"
          type={type === "date" ? "date" : "datetime-local"}
          aria-label={row.name}
          defaultValue={native}
          key={native}
          onChange={(e) => onCommit(e.currentTarget.value === "" ? null : e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onLeave();
            }
          }}
        />
      );
    }
  }

  const text = textOf(value);
  const numeric = type === "number";
  return (
    <input
      data-prop-value
      className={numeric ? "prop-input prop-mono" : "prop-input"}
      type={numeric ? "number" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      aria-label={row.name}
      defaultValue={text}
      key={text}
      spellCheck={false}
      onBlur={(e) => {
        const raw = e.currentTarget.value;
        if (raw === text) return;
        onCommit(numeric ? parseNumber(raw) : raw === "" ? null : raw);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          onLeave();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.value = text;
          onLeave();
        }
      }}
    />
  );
}

function Chips({
  name,
  type,
  items,
  suggestions,
  onCommit,
  onLeave,
}: {
  name: string;
  type: PropRow["type"];
  items: string[];
  suggestions: PropValue[];
  onCommit: (value: PropValue) => void;
  onLeave: () => void;
}) {
  const listId = useId();
  const suggested = suggestions
    .filter((s): s is string => typeof s === "string" && !items.includes(s))
    .slice(0, 20);

  const add = (input: HTMLInputElement) => {
    const next = listFor(type, [...items, input.value]);
    input.value = "";
    if (next.length !== items.length) onCommit(next);
  };

  return (
    <div className="prop-chips">
      {items.map((item) => (
        <span className="prop-chip" key={item}>
          {item}
          <button
            type="button"
            className="prop-chip-x"
            aria-label={`Remove ${item}`}
            onClick={() => onCommit(listFor(type, items.filter((x) => x !== item)))}
          >
            <CloseIcon width={10} height={10} />
          </button>
        </span>
      ))}
      <input
        data-prop-value
        className="prop-chip-input"
        list={listId}
        aria-label={`Add to ${name}`}
        placeholder={items.length === 0 ? "Add" : ""}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(e.currentTarget);
          } else if (e.key === "Backspace" && e.currentTarget.value === "" && items.length > 0) {
            onCommit(listFor(type, items.slice(0, -1)));
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.value = "";
            onLeave();
          }
        }}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() !== "") add(e.currentTarget);
        }}
      />
      <datalist id={listId}>
        {suggested.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
```

- [ ] **Step 4: Type button**

`web/src/components/properties/TypeButton.tsx`:

```tsx
import type { PropertyType } from "@brainmd/shared/property-types";
import { CHOOSABLE_TYPES, TYPE_META } from "../../properties/type-meta";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

interface Props {
  name: string;
  type: PropertyType;
  onPick: (type: PropertyType) => void;
}

// The type icon of a row. Clicking it changes the type for this name across
// the vault; tags and aliases are fixed, so their icon is not a button.
export function TypeButton({ name, type, onPick }: Props) {
  const { Icon, label } = TYPE_META[type];
  if (type === "tags" || type === "aliases") {
    return (
      <span className="prop-type" title={label} role="img" aria-label={`${name}: ${label}`}>
        <Icon width={14} height={14} />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="prop-type prop-type-btn" title={`${label}: change type`} aria-label={`${name} type: ${label}`}>
          <Icon width={14} height={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={type} onValueChange={(v) => onPick(v as PropertyType)}>
          {CHOOSABLE_TYPES.map((t) => {
            const meta = TYPE_META[t];
            return (
              <DropdownMenuRadioItem key={t} value={t}>
                <meta.Icon width={14} height={14} />
                <span className="ml-2">{meta.label}</span>
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add web/src/properties web/src/components/properties web/src/components/Icons.tsx
git commit -m "feat(web): property value editors, type menu and icons" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 9: Properties panel, Add property combobox, styles

**Files:**
- Create: `web/src/components/properties/PropertiesPanel.tsx`, `web/src/components/properties/AddProperty.tsx`, `web/src/styles/properties.css`

**Interfaces:**
- Consumes: everything from Tasks 7 and 8; `Popover*` from `web/src/components/ui/popover.tsx`; `cmdk`; `useLocal` from `web/src/state/store.ts`.
- Produces: `<PropertiesPanel variant="preview" | "editor" notePath content onEdit onFixInSource onNotice />` where `onEdit(edit: (current: string) => string): void`, `onFixInSource(offset: number): void`, `onNotice(message: string): void`. Keyboard: the toggle's ArrowDown enters the rows; Up/Down move between rows (and the Add button); Enter focuses a row's value; Escape leaves a control (back to the row) or the row (back to the toggle); Backspace on an empty name removes the property. Invalid YAML shows the parse error and a "Fix in source" button.

- [ ] **Step 1: Add property combobox**

`+ Add property` is a cmdk combobox in a popover, fed by `GET /api/properties` (most used first, keys the note already has are left out). Typing a new name offers `Create "name"` as text. cmdk gives Up/Down/Enter.

`web/src/components/properties/AddProperty.tsx`:

```tsx
import { useState } from "react";
import { Command } from "cmdk";
import type { PropertyInfo, PropertyType } from "@brainmd/shared/property-types";
import { TYPE_META } from "../../properties/type-meta";
import { PlusIcon } from "../Icons";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface Props {
  infos: PropertyInfo[];
  // Names this note already has.
  existing: Set<string>;
  onOpen: () => void;
  onAdd: (name: string, type: PropertyType) => void;
}

export function AddProperty({ infos, existing, onOpen, onAdd }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const candidates = infos.filter((i) => !existing.has(i.name));
  const canCreate =
    typed !== "" && typed !== "__proto__" && !existing.has(typed) && !infos.some((i) => i.name === typed);

  const pick = (name: string, type: PropertyType) => {
    setOpen(false);
    onAdd(name, type);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setQuery("");
        if (next) onOpen();
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className="props-add" data-prop-add>
          <PlusIcon width={14} height={14} />
          <span>Add property</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="props-add-pop">
        <Command label="Add property">
          <Command.Input
            className="props-add-input"
            placeholder="Property name"
            value={query}
            onValueChange={setQuery}
          />
          <Command.List className="props-add-list">
            <Command.Empty className="props-add-empty">No matching property</Command.Empty>
            {candidates.map((i) => {
              const Icon = TYPE_META[i.type].Icon;
              return (
                <Command.Item
                  key={i.name}
                  value={i.name}
                  className="props-add-item"
                  onSelect={() => pick(i.name, i.type)}
                >
                  <Icon width={14} height={14} />
                  <span className="props-add-name">{i.name}</span>
                  <span className="props-add-count">{i.count}</span>
                </Command.Item>
              );
            })}
            {canCreate ? (
              <Command.Item
                forceMount
                value={`create:${typed}`}
                className="props-add-item"
                onSelect={() => pick(typed, "text")}
              >
                <PlusIcon width={14} height={14} />
                <span className="props-add-name">Create "{typed}"</span>
              </Command.Item>
            ) : null}
          </Command.List>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: The panel**

`web/src/components/properties/PropertiesPanel.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { api } from "../../api/client";
import { buildModel, editRename, editSet, editUnset, initialValue } from "../../properties/model";
import { useProperties } from "../../properties/useProperties";
import { useLocal } from "../../state/store";
import { ChevRightIcon, CloseIcon } from "../Icons";
import { AddProperty } from "./AddProperty";
import { TypeButton } from "./TypeButton";
import { ValueEditor } from "./ValueEditor";

interface Props {
  // Above the preview, or above the editor when the preview is hidden.
  variant: "preview" | "editor";
  notePath: string;
  content: string;
  // Applies a pure text edit to the open note: a CodeMirror transaction when
  // the editor is mounted, the content state otherwise.
  onEdit: (edit: (current: string) => string) => void;
  onFixInSource: (offset: number) => void;
  onNotice: (message: string) => void;
}

function rowEl(root: HTMLElement | null, name: string): HTMLElement | null {
  if (!root) return null;
  return Array.from(root.querySelectorAll<HTMLElement>("[data-prop-row]")).find((el) => el.dataset.propRow === name) ?? null;
}

export function PropertiesPanel({ variant, notePath, content, onEdit, onFixInSource, onNotice }: Props) {
  const [openPreview, setOpenPreview] = useLocal("brain.props.open.preview", true);
  const [openEditor, setOpenEditor] = useLocal("brain.props.open.editor", false);
  const open = variant === "preview" ? openPreview : openEditor;
  const setOpen = variant === "preview" ? setOpenPreview : setOpenEditor;

  const { infos, refresh } = useProperties(notePath);
  const model = useMemo(() => buildModel(content, infos), [content, infos]);
  const suggestions = useMemo(() => new Map(infos.map((i) => [i.name, i.values])), [infos]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<string | null>(null);

  const run = useCallback(
    (edit: (current: string) => string) => {
      try {
        onEdit(edit);
      } catch (e) {
        onNotice(e instanceof Error ? e.message : String(e));
      }
    },
    [onEdit, onNotice],
  );

  useEffect(() => {
    const name = pendingFocus.current;
    if (!name || model.kind !== "rows") return;
    const row = rowEl(bodyRef.current, name);
    if (!row) return;
    pendingFocus.current = null;
    row.querySelector<HTMLElement>("[data-prop-value]")?.focus();
  }, [model]);

  const changeType = async (name: string, type: PropertyType) => {
    try {
      await api.setPropertyType(name, type);
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onNotice(msg.startsWith("403") ? "Only the owner can change property types" : `Could not change the type: ${msg}`);
    }
  };

  const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-prop-row]"));
    const addBtn = e.currentTarget.querySelector<HTMLElement>("[data-prop-add]");
    if (target === addBtn && e.key === "ArrowUp") {
      e.preventDefault();
      (rows[rows.length - 1] ?? toggleRef.current)?.focus();
      return;
    }
    if (!target.hasAttribute("data-prop-row")) return;
    const i = rows.indexOf(target);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      (rows[i + 1] ?? addBtn)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (i > 0 ? rows[i - 1] : toggleRef.current)?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      target.querySelector<HTMLElement>("[data-prop-value]")?.focus();
    } else if (e.key === "Escape") {
      toggleRef.current?.focus();
    }
  };

  const rows = model.kind === "rows" ? model.rows : [];
  const taken = new Set(rows.map((r) => r.name));

  return (
    <section className={clsx("props-panel", variant === "editor" && "in-editor")} aria-label="Properties">
      <button
        ref={toggleRef}
        type="button"
        className="props-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            (bodyRef.current?.querySelector<HTMLElement>("[data-prop-row]") ?? bodyRef.current?.querySelector<HTMLElement>("[data-prop-add]"))?.focus();
          }
        }}
      >
        <ChevRightIcon className={clsx("props-chev", open && "open")} width={12} height={12} />
        <span>{rows.length > 0 ? `Properties (${rows.length})` : "Properties"}</span>
      </button>

      {model.kind === "error" ? (
        <div className="props-error" role="alert">
          <span className="props-error-text" title={model.message}>
            {model.message.split("\n")[0]}
          </span>
          <button type="button" className="btn" onClick={() => onFixInSource(model.offset)}>
            Fix in source
          </button>
        </div>
      ) : open ? (
        <div className="props-body" ref={bodyRef} onKeyDown={onBodyKeyDown}>
          {model.kind === "rows"
            ? model.rows.map((row) => (
                <div key={row.name} className="prop-row" data-prop-row={row.name} tabIndex={-1} role="group" aria-label={row.name}>
                  <TypeButton name={row.name} type={row.type} onPick={(t) => void changeType(row.name, t)} />
                  <NameInput
                    name={row.name}
                    taken={taken}
                    onNotice={onNotice}
                    onRename={(to) => run(editRename(row.name, to))}
                    onRemove={() => run(editUnset(row.name))}
                    onLeave={() => rowEl(bodyRef.current, row.name)?.focus()}
                  />
                  <div className="prop-value">
                    <ValueEditor
                      row={row}
                      suggestions={suggestions.get(row.name) ?? []}
                      onCommit={(v: PropValue) => run(editSet(row.name, v))}
                      onLeave={() => rowEl(bodyRef.current, row.name)?.focus()}
                      onEditInSource={() => onFixInSource(model.offset)}
                    />
                  </div>
                  <button
                    type="button"
                    className="prop-remove"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => run(editUnset(row.name))}
                  >
                    <CloseIcon width={12} height={12} />
                  </button>
                </div>
              ))
            : null}
          <AddProperty
            infos={infos}
            existing={taken}
            onOpen={refresh}
            onAdd={(name, type) => {
              pendingFocus.current = name;
              run(editSet(name, initialValue(type)));
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

function NameInput({
  name,
  taken,
  onNotice,
  onRename,
  onRemove,
  onLeave,
}: {
  name: string;
  taken: Set<string>;
  onNotice: (message: string) => void;
  onRename: (to: string) => void;
  onRemove: () => void;
  onLeave: () => void;
}) {
  return (
    <input
      className="prop-name"
      aria-label="Property name"
      defaultValue={name}
      key={name}
      spellCheck={false}
      onBlur={(e) => {
        const to = e.currentTarget.value.trim();
        if (to === name) return;
        if (to === "" || to === "__proto__") {
          e.currentTarget.value = name;
          return;
        }
        if (taken.has(to)) {
          e.currentTarget.value = name;
          onNotice(`"${to}" already exists in this note`);
          return;
        }
        onRename(to);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          onLeave();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.value = name;
          onLeave();
        } else if (e.key === "Backspace" && e.currentTarget.value === "") {
          e.preventDefault();
          onRemove();
        }
      }}
    />
  );
}
```

- [ ] **Step 3: Styles**

`web/src/styles/properties.css`:

```css
.props-panel {
  margin: 0 0 var(--space-4);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  color: var(--text-1);
}
.props-panel.in-editor {
  margin: 0;
  padding: 0 var(--space-3);
  border-bottom: 1px solid var(--border);
  background: var(--bg-surface);
  flex: none;
}
.props-panel.in-editor .props-body {
  max-height: 40vh;
  overflow-y: auto;
}

.props-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-height: 28px;
  padding: 0 var(--space-2) 0 0;
  border: 0;
  background: none;
  color: var(--text-3);
  font: inherit;
  cursor: pointer;
  border-radius: var(--radius-1);
}
.props-toggle:hover {
  color: var(--text-1);
}
.props-chev {
  transition: transform 120ms ease;
}
.props-chev.open {
  transform: rotate(90deg);
}

.props-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.prop-row {
  display: grid;
  grid-template-columns: 24px minmax(80px, 140px) minmax(0, 1fr) 24px;
  align-items: center;
  column-gap: var(--space-2);
  min-height: 28px;
  border-radius: var(--radius-1);
}
.prop-row:hover,
.prop-row:focus-within {
  background: var(--bg-hover);
}
.prop-row:focus {
  outline: none;
  background: var(--bg-selected);
}

.prop-type {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--text-4);
  border-radius: var(--radius-1);
}
.prop-type-btn {
  border: 0;
  background: none;
  cursor: pointer;
}
.prop-type-btn:hover {
  color: var(--text-1);
  background: var(--bg-active);
}

.prop-name,
.prop-input,
.prop-chip-input {
  min-width: 0;
  width: 100%;
  height: 24px;
  padding: 0 var(--space-1);
  border: 1px solid transparent;
  border-radius: var(--radius-1);
  background: transparent;
  color: inherit;
  font: inherit;
}
.prop-name {
  color: var(--text-3);
}
.prop-mono {
  font-family: var(--font-mono);
}
.prop-name:focus,
.prop-input:focus,
.prop-chip-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg-surface);
  color: var(--text-1);
}

.prop-check {
  width: 16px;
  height: 16px;
  margin: 0 var(--space-1);
  accent-color: var(--accent);
}

.prop-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}
.prop-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  height: 22px;
  padding: 0 var(--space-1) 0 var(--space-2);
  border-radius: var(--radius-1);
  background: var(--accent-soft);
  color: var(--text-1);
}
.prop-chip-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-1);
  background: none;
  color: var(--text-3);
  cursor: pointer;
}
.prop-chip-x:hover {
  color: var(--text-1);
  background: var(--bg-active);
}
.prop-chip-input {
  flex: 1 1 80px;
  width: auto;
}

.prop-nested {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}
.prop-nested-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--text-3);
}
.prop-link {
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}

.prop-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-1);
  background: none;
  color: var(--text-4);
  cursor: pointer;
  opacity: 0;
}
.prop-row:hover .prop-remove,
.prop-row:focus-within .prop-remove,
.prop-remove:focus-visible {
  opacity: 1;
}
.prop-remove:hover {
  color: var(--text-1);
  background: var(--bg-active);
}

.props-add {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: flex-start;
  min-height: 28px;
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-1);
  background: none;
  color: var(--text-3);
  font: inherit;
  cursor: pointer;
}
.props-add:hover,
.props-add:focus-visible {
  color: var(--text-1);
  background: var(--bg-hover);
}

.props-add-pop {
  width: 260px;
  padding: 0;
}
.props-add-input {
  width: 100%;
  height: 36px;
  padding: 0 var(--space-3);
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text-1);
  font: inherit;
  outline: none;
}
.props-add-list {
  max-height: 260px;
  overflow-y: auto;
  padding: var(--space-1);
}
.props-add-empty {
  padding: var(--space-3);
  color: var(--text-3);
  font-size: var(--text-sm);
}
.props-add-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 28px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-1);
  color: var(--text-1);
  font-size: var(--text-sm);
  cursor: pointer;
}
.props-add-item[data-selected="true"] {
  background: var(--bg-hover);
}
.props-add-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.props-add-count {
  color: var(--text-4);
  font-family: var(--font-mono);
}

.props-error {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-1);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--callout-danger);
  border-radius: var(--radius-2);
}
.props-error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--callout-danger);
}

@media (pointer: coarse) {
  .props-toggle,
  .props-add,
  .props-add-item {
    min-height: 40px;
  }
  .prop-row {
    min-height: 40px;
    grid-template-columns: 40px minmax(72px, 120px) minmax(0, 1fr) 40px;
  }
  .prop-type,
  .prop-remove {
    width: 40px;
    height: 40px;
  }
  .prop-name,
  .prop-input,
  .prop-chip-input {
    height: 40px;
    font-size: 16px;
  }
  .prop-chip {
    height: 32px;
  }
  .prop-chip-x {
    width: 28px;
    height: 28px;
  }
  .prop-check {
    width: 24px;
    height: 24px;
  }
  .prop-remove {
    opacity: 1;
  }
  .props-error .btn {
    min-height: 40px;
  }
}
```

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: clean. (The stylesheet is imported in Task 10.)

- [ ] **Step 5: Commit**

```bash
git add web/src/components/properties web/src/styles/properties.css
git commit -m "feat(web): Properties panel with add-property combobox and keyboard model" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

### Task 10: Mount the panel, route edits through the editor, remove PropsRender

**Files:**
- Modify: `web/src/App.tsx`, `web/src/components/Preview.tsx`, `web/src/styles/preview.css`

**Interfaces:**
- Consumes: `PropertiesPanel` (Task 9), `minimalChange` (Task 7).
- Produces: `Preview` prop `header?: ReactNode`; in `App`, `editContent(edit)` (CodeMirror transaction over the changed bytes when `editorViewRef.current` exists, else `setContent`), `focusFrontmatter(offset)`, and `previewShown` deciding whether the panel renders above the preview or above the editor.

- [ ] **Step 1: Wire it up**

How it behaves: with the editor mounted, an edit is one `view.dispatch` with `userEvent: "input.properties"`, so the existing `onChange` -> `setContent` -> autosave and status chip path runs, undo works, and the next save carries `base_revision`. The edit function runs against the live document, not the React state, so a keystroke not yet flushed to state is not lost. "Fix in source" switches to the editor when it is hidden (mobile Edit tab, or preview-only layout) and puts the cursor in the frontmatter.

```diff
--- a/web/src/App.tsx
+++ b/web/src/App.tsx
@@ -6,6 +6,8 @@
 import { FileTree } from "./components/FileTree";
 import { Editor } from "./components/Editor";
 import { Preview, type PreviewHandle } from "./components/Preview";
+import { PropertiesPanel } from "./components/properties/PropertiesPanel";
+import { minimalChange } from "./properties/model";
 import { Backlinks } from "./components/Backlinks";
 import { Related } from "./components/Related";
 import type { RelatedHit } from "./api/client";
@@ -108,6 +110,7 @@
 import "./styles/history.css";
 import "./styles/graph.css";
 import "./styles/changes.css";
+import "./styles/properties.css";
 import "./styles/hljs.css";
 import "katex/dist/katex.min.css";
 
@@ -267,6 +270,55 @@
     [content, path],
   );
   const editorViewRef = useRef<EditorView | null>(null);
+  const contentRef = useRef(content);
+  useEffect(() => {
+    contentRef.current = content;
+  }, [content]);
+  // Property edits from the panel. With the editor mounted they are one
+  // CodeMirror transaction over the changed bytes, so undo, autosave, the
+  // status chip and base_revision behave as for typing; without it the
+  // content state is edited directly.
+  const editContent = useCallback((edit: (current: string) => string) => {
+    const view = editorViewRef.current;
+    const current = view ? view.state.doc.toString() : contentRef.current;
+    const next = edit(current);
+    if (view) {
+      const change = minimalChange(current, next);
+      if (change) view.dispatch({ changes: change, userEvent: "input.properties" });
+    } else if (next !== current) {
+      setContent(next);
+    }
+  }, []);
+  // "Fix in source": show the editor if it is hidden, then put the cursor in
+  // the frontmatter.
+  const focusFrontmatter = useCallback(
+    (offset: number) => {
+      if (isMobile) setMobileView("edit");
+      else if (desktopView === "preview") setDesktopView("split");
+      window.setTimeout(() => {
+        const view = editorViewRef.current;
+        if (!view) return;
+        view.dispatch({ selection: { anchor: Math.min(offset, view.state.doc.length) }, scrollIntoView: true });
+        view.focus();
+      }, 50);
+    },
+    [isMobile, desktopView, setDesktopView],
+  );
+  // The panel lives above the preview; when the preview is hidden (editor
+  // only, or the mobile Edit tab) it moves above the editor instead.
+  const previewShown = isMobile ? mobileView === "preview" : desktopView !== "edit";
+  const propsPanel = (variant: "preview" | "editor") =>
+    path && !tagFilter ? (
+      <PropertiesPanel
+        key={path}
+        variant={variant}
+        notePath={path}
+        content={content}
+        onEdit={editContent}
+        onFixInSource={focusFrontmatter}
+        onNotice={setToast}
+      />
+    ) : null;
   const uploadInputRef = useRef<HTMLInputElement | null>(null);
   const previewHandleRef = useRef<PreviewHandle | null>(null);
   const mainRef = useRef<HTMLElement | null>(null);
@@ -1551,6 +1603,7 @@
             <TagFilterView tag={tagFilter} notes={tagFilteredNotes ?? []} onOpen={openNote} onClear={() => setTagFilter(null)} />
           ) : path ? (
             <>
+              {previewShown ? null : propsPanel("editor")}
               <Editor
                 value={content}
                 onChange={setContent}
@@ -1591,6 +1644,7 @@
             ref={previewHandleRef}
             content={content}
             notePath={path}
+            header={previewShown ? propsPanel("preview") : null}
             resolveByBasename={resolveWikilink}
             onOpenNote={openNote}
             onMissingNote={askCreateMissing}
```

```diff
--- a/web/src/components/Preview.tsx
+++ b/web/src/components/Preview.tsx
@@ -1,4 +1,4 @@
-import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
+import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
 import { renderMarkdown, isMediaName } from "../renderer/render";
 import { api } from "../api/client";
 import { getToken } from "../auth/token";
@@ -42,6 +42,8 @@
 interface PreviewProps {
   content: string;
   notePath: string | null;
+  // Rendered at the top of the document, above the note body.
+  header?: ReactNode;
   resolveByBasename: (name: string, fromPath?: string) => string | null;
   onOpenNote: (path: string) => void;
   // A [[link]] whose target doesn't exist yet.
@@ -57,7 +59,7 @@
 }
 
 export const Preview = forwardRef<PreviewHandle, PreviewProps>(function Preview(
-  { content, notePath, resolveByBasename, onOpenNote, onMissingNote, onOpenTag, onScrollLine, onSelectLine },
+  { content, notePath, header, resolveByBasename, onOpenNote, onMissingNote, onOpenTag, onScrollLine, onSelectLine },
   forwardedRef,
 ) {
   const ref = useRef<HTMLDivElement | null>(null);
@@ -67,7 +69,7 @@
   const suppressScrollRef = useRef<number>(0);
   const mediaBlobUrlsRef = useRef<string[]>([]);
 
-  const { html, frontmatter, frontmatterError } = useMemo(() => {
+  const { html } = useMemo(() => {
     const dirOf = notePath ? notePath.replace(/[^/]+$/, "") : "";
     return renderMarkdown(content, {
       resolveWikilink: (target) => resolveByBasename(target),
@@ -370,12 +372,7 @@
   return (
     <div className="preview scroll" ref={ref}>
       <div className="doc" ref={docRef}>
-        {frontmatterError ? (
-          <div className="frontmatter-error">frontmatter: {frontmatterError}</div>
-        ) : null}
-        {frontmatter && Object.keys(frontmatter).length > 0 ? (
-          <PropsRender data={frontmatter} />
-        ) : null}
+        {header}
         {content.trim() === "" ? (
           notePath ? <p className="muted">Empty note</p> : null
         ) : (
@@ -387,26 +384,6 @@
   );
 });
 
-function PropsRender({ data }: { data: Record<string, unknown> }) {
-  return (
-    <div className="props">
-      {Object.entries(data).map(([k, v]) => (
-        <div className="props-row" key={k}>
-          <span className="k">{k}</span>
-          <span className="v">{formatValue(v)}</span>
-        </div>
-      ))}
-    </div>
-  );
-}
-
-function formatValue(v: unknown): string {
-  if (v === null || v === undefined) return "";
-  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(", ");
-  if (typeof v === "object") return JSON.stringify(v);
-  return String(v);
-}
-
 function escapeHtml(s: string): string {
   return s
     .replace(/&/g, "&amp;")
```

In `web/src/styles/preview.css` delete the `.preview .doc .frontmatter-error { ... }` rule and the `.props`, `.props-row`, `.props-row:last-child`, `.props-row .k`, `.props-row .v` rules (the panel replaces them):

```diff
--- a/web/src/styles/preview.css
+++ b/web/src/styles/preview.css
@@ -428,17 +428,6 @@
   padding-left: var(--space-4);
 }
 
-.preview .doc .frontmatter-error {
-  color: var(--callout-danger);
-  font-family: var(--font-mono);
-  font-size: var(--text-sm);
-  background: rgba(239, 68, 68, 0.08);
-  border: 1px solid var(--callout-danger);
-  border-radius: var(--radius-2);
-  padding: var(--space-2) var(--space-3);
-  margin: var(--space-3) 0;
-}
-
 .preview .doc :is(.katex-display) {
   margin: var(--space-3) 0;
   overflow-x: auto;
@@ -475,31 +464,3 @@
   background: var(--accent);
   pointer-events: none;
 }
-
-.props {
-  border: 1px solid var(--border);
-  background: var(--bg-surface);
-  border-radius: var(--radius-2);
-  padding: var(--space-2) var(--space-3);
-  margin: 0 0 var(--space-4);
-  font-family: var(--font-sans);
-  font-size: var(--text-sm);
-}
-.props-row {
-  display: grid;
-  grid-template-columns: 120px 1fr;
-  gap: var(--space-3);
-  padding: 4px 0;
-  border-bottom: 1px dashed var(--border);
-}
-.props-row:last-child {
-  border-bottom: none;
-}
-.props-row .k {
-  color: var(--text-3);
-  text-transform: lowercase;
-}
-.props-row .v {
-  color: var(--text-1);
-  word-break: break-word;
-}
```

- [ ] **Step 2: Typecheck, tests and build**

Run: `bun run typecheck && (cd web && bun test) && bun run --cwd web build`
Expected: all clean. Also run `grep -rn "PropsRender\|frontmatter-error\|props-row" web/src` and expect no output.

- [ ] **Step 3: Manual check in a browser (screenshots)**

Create a scratch vault and run the app:

```bash
mkdir -p /tmp/props-vault && printf -- '---\n# keep\nid: 007\nstatus: todo\ntags: [a, b]\ndue: 2026-12-01\ndone: false\nnested:\n  k: 1\n---\n\n# Hello\n' > /tmp/props-vault/hello.md
printf -- '---\na: [1\n---\n\nbroken\n' > /tmp/props-vault/broken.md
VAULT_DIR=/tmp/props-vault bun run dev:server   # terminal 1
bun run dev:web                                  # terminal 2, open http://localhost:5173
```

Check each item and take a screenshot of the panel (desktop split, Editor-only, and a 390px wide phone viewport):

1. `hello.md` split layout: panel above the preview, 6 rows, type icons, `due` shown in the mono font as a date input, `done` as a checkbox, `tags` as chips, `nested` read-only with "edit in source".
2. Change `status` to `done`, press Enter. The source shows only `status: done` changed; `# keep`, `id: 007` and the list style are untouched. The status chip goes to Saving then Saved. Ctrl/Cmd+Z in the editor undoes it.
3. Add a tag chip with Enter; remove one with its x.
4. `+ Add property`: the popover lists vault keys most used first; type a new name and pick `Create "..."`; the new row's value input is focused. Add `status` from the list on another note.
5. Keyboard: Tab to "Properties (n)", ArrowDown enters rows, Up/Down move, Enter edits, Escape returns. Clear a name and press Backspace: the row is removed.
6. Click a type icon, choose Number for `status`; the vault-wide type changes and no note text changes (`git status` in the vault shows nothing new from this).
7. `broken.md`: the panel shows the YAML error and "Fix in source" focuses the editor on the frontmatter. In Preview-only layout it first switches to Split.
8. Editor-only layout: the panel sits above the editor, collapsed to "Properties (n)", and expands. A second tab editing the same note then saving yields the conflict toast, not a silent overwrite.
9. At 390px wide with a coarse pointer (DevTools device mode): rows are at least 40px tall, the remove button is always visible, input text is 16px (no iOS zoom).

If a check fails, fix it in the file that owns the behaviour and re-run the checks.

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "feat(web): show the Properties panel above the preview or the editor" -m "Claude-Session: https://claude.ai/code/session_016CA1ewV61m4dPAsn1msKrA"
```

---

## Self-Review

**Spec coverage (Phase 1).**
- Index `props`, `ctime`, version 3, `propertyKeys` with count, type and 20 values: Task 3.
- Type registry (`.brain/types.json`, `.obsidian/types.json` fallback, unknown reads as text, inference, `tags` and `aliases` fixed): Tasks 2 and 4.
- Shared package, `readFrontmatter`, `setProperties`, `renameProperty`, splice editing, CRLF, BOM, `007`, comments, flow and unindented lists, nested maps, invalid YAML refused: Task 1.
- `GET /api/properties` filtered by read permission, `PUT /api/properties/types` owner only: Task 4. `PATCH /api/note-properties/*` with 409 and 422: Task 5.
- MCP `update_properties` and `read_note.properties`, tool count 18 -> 19 in the four places: Task 6.
- Panel: rows with type icon, name, typed value editors, chips with suggestions, nested read-only with "edit in source", `+ Add property` combobox fed by vault keys, keyboard model, CodeMirror transaction on the frontmatter bytes with `setContent` fallback, invalid YAML with "Fix in source", Editor-only layout collapsed above the editor: Tasks 7 to 10.
- Out of scope per the spec and not planned: views, `query_notes`, table editing, nested property editing.

**Placeholder scan.** No TBD or "similar to" steps; every code step carries the code or an exact diff. The two documented limits are stated as decisions (empty `---\n---` block, type changes never rewrite notes).

**Type consistency.** `PropValue`, `FrontmatterRead`, `FrontmatterError`, `PropertyType`, `PropertyInfo`, `resolveType(name, registered, inferred)`, `propertyKeys`, `listProperties`, `updateProperties(vault, path, input, canRead)`, `PanelModel`, `PropRow`, `editSet/editUnset/editRename`, `minimalChange`, `onEdit(edit)` and `data-prop-value` / `data-prop-row` / `data-prop-add` are used with the same names and shapes in every task that mentions them.
