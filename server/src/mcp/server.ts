// @ts-nocheck — MCP SDK's registerTool generics + zod schema inference
// trigger a TS stack overflow when many tools are registered in one file.
// Runtime behaviour is unaffected; types are still checked at call sites
// outside this module.
import { Elysia } from "elysia";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { pageArgs, pageContent, paginate } from "./paginate";
import { NoteConflictError, type Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import type { RagPipeline } from "../rag/pipeline";
import { search as fullTextSearch } from "../index/search";
import {
  loadFolderMeta,
  resolveFolderPerms,
  type McpFolderPerms,
} from "../api/folder-perms";
import {
  principalCanRead,
  principalCanWrite,
  bypassesFolderPermsForMcp,
  type Principal,
} from "../api/principal";
import { principalFor } from "../api/auth-middleware";
import { findBaseFences } from "@brainmd/shared/base-yaml";
import { parseBase } from "@brainmd/shared/base-parse";
import { runBaseQuery, queryIndexFor } from "../bases/query";
import { simpleBase } from "../bases/simple";
import { listProperties } from "../properties/registry";
import { loadMcpInstructions } from "./instructions";
import { readFrontmatter } from "@brainmd/shared/frontmatter";
import { updateProperties } from "../properties/update";
import { buildGraph, graphSummary, neighbourhood } from "../index/graph";
import {
  MODEL_ONLY_META,
  GRAPH_VIEW_MAX_NODES,
  GRAPH_VIEW_META_KEY,
  NOTE_VIEW_META_KEY,
  appResources,
  graphToolMeta,
  loadViews,
  noteToolMeta,
  noteViewData,
  type AppViews,
  type ViewLoader,
} from "./apps";
import { VERSION } from "../version";
import {
  related as qRelated,
  contextForQuery as qContext,
  semanticOutline as qOutline,
  orphans as qOrphans,
  weeklyDigest as qDigest,
  compareNotes as qCompare,
  similarTasks as qSimilarTasks,
  normalizeScope,
  inScope,
  RagDisabledError,
  semanticUnavailable,
  keywordHits,
  type RagDeps,
} from "../rag/queries";
import { StoreIncompatibleError } from "../rag/store";

// MCP tool annotations. Hosts such as OpenClaw use them for approval modes:
// read-only tools can run without a prompt while writes still ask. The RAG
// tools leave openWorldHint unset because a configured remote embedder
// receives the query text.
const QUERY_CELL_CHARS = 500;
const QUERY_REPLY_BYTES = 200_000;

const READ_ONLY_LOCAL = { readOnlyHint: true, openWorldHint: false } as const;
const READ_ONLY_RAG = { readOnlyHint: true } as const;
// Not idempotent: a repeat with the same content still bumps mtime and
// notifies watchers, even when git sees no change.
const WRITE_NOTE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const APPEND_NOTE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

// Same value twice gives the same note, and an unchanged note is not
// rewritten, so a repeat is idempotent. Overwriting a value is still
// destructive in MCP's terms.
const UPDATE_PROPERTIES_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const TASK_RE = /^(\s*[-*+])\s+\[([ xX])\]\s+(.*)$/;

// V69: shared schema for the optional folder scope every search/RAG tool accepts.
// A scope is one or more folder prefixes; matches that folder and its subfolders.
const scopeSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe(
    "Optional folder scope: limit results to one folder path or an array of folder paths (prefix match, subfolders included). e.g. \"work\" or [\"work\",\"private/Journal\"]. Omit for the whole vault.",
  );

function collectTasks(index: VaultIndex): Array<{
  path: string;
  lineNo: number;
  done: boolean;
  text: string;
}> {
  const out: Array<{ path: string; lineNo: number; done: boolean; text: string }> = [];
  for (const entry of index.entries()) {
    const lines = entry.body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = (lines[i] ?? "").match(TASK_RE);
      if (!m) continue;
      out.push({
        path: entry.path,
        lineNo: i + 1,
        done: (m[2] ?? " ").toLowerCase() === "x",
        text: (m[3] ?? "").trim(),
      });
    }
  }
  return out;
}

// V46 / V52: HTTP+SSE-mounted MCP server. Same Elysia app, same bearer auth
// (the global auth middleware already covers /mcp/*). Per-tool folder perm
// checks happen inside each handler.
//
// Tools: search_notes, similar_notes, read_note, list_notes,
//        get_backlinks, list_tags, get_tasks, write_note, append_note
// Resources: vault://tree, vault://note/<path>

interface McpDeps {
  vault: Vault;
  index: VaultIndex;
  visibility: { isHidden(path: string): boolean };
  pipeline: RagPipeline;
  ragEnabled: () => boolean;
  loadView?: ViewLoader;
}

async function readPerms(vault: Vault): Promise<Record<string, McpFolderPerms>> {
  const meta = await loadFolderMeta(vault);
  return meta.mcp;
}

function denied(perm: "read" | "write", path: string): never {
  const e: Error & { code?: string } = new Error(
    `[mcp] ${perm} denied for ${path} by folder permissions`,
  );
  e.code = perm === "read" ? "MCP_READ_DENIED" : "MCP_WRITE_DENIED";
  throw e;
}

function scopeDenied(perm: "read" | "write"): never {
  const e: Error & { code?: string } = new Error(
    `[mcp] ${perm} denied: this token's OAuth grant does not include vault:${perm}`,
  );
  e.code = perm === "read" ? "MCP_READ_DENIED" : "MCP_WRITE_DENIED";
  throw e;
}

// Combines the caller's own scope (owner / API key / OAuth grant) with the
// per-folder MCP permission for `path`. A read-only OAuth token must not be
// able to call write_note just because the folder itself allows writes, and
// an owner session must not be blocked by a folder someone restricted for
// agents.
async function checkRead(vault: Vault, principal: Principal, path: string): Promise<void> {
  if (!principalCanRead(principal)) scopeDenied("read");
  if (bypassesFolderPermsForMcp(principal)) return;
  const perms = resolveFolderPerms(path, await readPerms(vault));
  if (!perms.read) denied("read", path);
}

async function checkWrite(vault: Vault, principal: Principal, path: string): Promise<void> {
  if (!principalCanWrite(principal)) scopeDenied("write");
  if (bypassesFolderPermsForMcp(principal)) return;
  const perms = resolveFolderPerms(path, await readPerms(vault));
  if (!perms.write) denied("write", path);
}

// Filter for list/search-style tools: true if this principal may see `path`.
async function mayRead(
  principal: Principal,
  path: string,
  map: Record<string, McpFolderPerms>,
): Promise<boolean> {
  if (!principalCanRead(principal)) return false;
  if (bypassesFolderPermsForMcp(principal)) return true;
  return resolveFolderPerms(path, map).read;
}

function logCall(name: string, args: unknown, ok: boolean): void {
  // V46: audit log to stderr (servers usually capture stderr)
  const argSummary = JSON.stringify(args).slice(0, 200);
  console.error(`[mcp] tool=${name} ok=${ok} args=${argSummary}`);
}

// Single error shape for every tool: {error, code}. Keeps the caller's own
// .code (e.g. MCP_READ_DENIED from denied()/scopeDenied(), or a
// RagDisabledError's RAG_DISABLED) instead of letting the MCP SDK's default
// error handler flatten it down to a plain message, which it does for any
// exception a tool handler lets escape.
function toolError(name: string, args: unknown, err: unknown) {
  logCall(name, args, false);
  const isDisabled = err instanceof RagDisabledError;
  const code = isDisabled
    ? "RAG_DISABLED"
    : err instanceof Error && typeof (err as { code?: unknown }).code === "string"
      ? (err as { code: string }).code
      : "MCP_ERROR";
  const message = isDisabled ? "RAG disabled" : err instanceof Error ? err.message : String(err);
  const extra =
    err instanceof NoteConflictError
      ? {
          current_revision: err.currentRevision,
          hint: "read_note again, merge your change into the current content, and retry with the new base_revision",
        }
      : {};
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message, code, ...extra }) }],
  } as const;
}

// MCP clients (Claude Desktop, LM Studio, …) open and close transports
// at will. The SDK's stateless mode requires a NEW Server + Transport
// per request, so we extract handler registration here and rebuild
// both objects on every /mcp request inside mcpRoutes() below.
function registerHandlers(
  server: McpServer,
  deps: McpDeps,
  principal: Principal,
  views: AppViews,
): void {
  const { vault, index, pipeline, ragEnabled, visibility } = deps;

  // Shared read-permission predicate for this request: true if `principal`
  // may see `path`, combining its own scope with per-folder MCP perms.
  const readFilter = async (): Promise<(path: string) => boolean> => {
    if (!principalCanRead(principal)) return () => false;
    if (bypassesFolderPermsForMcp(principal)) return () => true;
    const map = await readPerms(vault);
    return (path: string) => resolveFolderPerms(path, map).read;
  };

  // ---------------- tools ----------------

  server.registerTool(
    "search_notes",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "Full-text search across the vault, best hits first, 20 per page by default (`limit`, `offset` for more, up to 200 hits in all). " +
        "Optional `scope` confines the search to one or more folders. " +
        "Notes the owner hid (hidden globs, `hidden: true`, `search: false`) are skipped unless include_hidden is true.",
      inputSchema: {
        query: z.string().min(1),
        scope: scopeSchema,
        include_hidden: z.boolean().optional(),
        ...pageArgs(20, 50),
      },
    },
    async ({ query, scope, include_hidden, limit, offset }) => {
      const allowed = await readFilter();
      const hits = fullTextSearch(index, query, scope, allowed, { includeHidden: include_hidden === true, max: 200 });
      const p = paginate(hits, limit, offset, 20);
      logCall("search_notes", { query, scope, limit, offset }, true);
      return pageContent("search_notes", p.items, p, "hits");
    },
  );

  server.registerTool(
    "similar_notes",
    {
      annotations: READ_ONLY_RAG,
      description:
        "Semantic (vector) search via RAG. Returns top-k chunks with paths and snippets. Optional `scope` confines results to one or more folders.",
      inputSchema: {
        query: z.string().min(1),
        k: z.number().int().min(1).max(50).optional(),
        scope: scopeSchema,
      },
    },
    async ({ query, k, scope }) => {
      if (!ragEnabled()) {
        logCall("similar_notes", { query, k, scope }, false);
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "RAG disabled", code: "RAG_DISABLED" }),
            },
          ],
        };
      }
      const prefixes = normalizeScope(scope);
      const limit = k ?? 5;
      const allowed = await readFilter();
      let hits: Array<{ path: string }>;
      try {
        const total = await pipeline.store.countAll().catch(() => 0);
        // Nothing embedded yet (first index still running): keywords.
        if (total === 0) throw new StoreIncompatibleError("index building");
        const [vec] = await pipeline.embedQuery([query]);
        // Over-fetch so enough in-scope, permitted hits survive both filters.
        const needsOverfetch = prefixes.length > 0 || !bypassesFolderPermsForMcp(principal);
        const raw = await pipeline.search(vec!, needsOverfetch ? limit + 50 : limit);
        hits = raw
          .filter((h) => inScope(h.path, prefixes))
          .filter((h) => allowed(h.path))
          .slice(0, limit);
      } catch (e) {
        if (!semanticUnavailable(e)) throw e;
        // Each hit says `"source": "keyword"` so the agent knows these are
        // keyword matches, not semantic neighbours.
        hits = keywordHits(index, query, limit, prefixes, allowed);
      }
      logCall("similar_notes", { query, k, scope }, true);
      return { content: [{ type: "text", text: JSON.stringify(hits) }] };
    },
  );

  server.registerTool(
    "read_note",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "Read a single note. Returns content, mtime, revision and `properties`: the parsed frontmatter " +
        "mapping (null when the note has no frontmatter or it is not valid YAML).",
      inputSchema: { path: z.string().min(1) },
      ...noteToolMeta(views),
    },
    async ({ path }) => {
      try {
        await checkRead(vault, principal, path);
        const note = await vault.readNote(path);
        logCall("read_note", { path }, true);
        const result = {
          content: [{ type: "text", text: JSON.stringify({ ...note, properties: readFrontmatter(note.content).props }) }],
        };
        if (!views.note) return result;
        return { ...result, _meta: { [NOTE_VIEW_META_KEY]: noteViewData(index, note.path, await readFilter()) } };
      } catch (err) {
        return toolError("read_note", { path }, err);
      }
    },
  );

  server.registerTool(
    "list_notes",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "List notes (and folders) in the vault or under `folder`, 100 notes per page by default; `limit` and `offset` page " +
        "through the rest (the reply says total_notes and next_offset). Folders come with the first page. Hidden notes and " +
        "folders (the owner's hidden globs, `hidden: true`) are left out unless include_hidden is true; read_note and " +
        "write_note work on them by path either way.",
      inputSchema: { folder: z.string().optional(), include_hidden: z.boolean().optional(), ...pageArgs(100, 1000) },
    },
    async ({ folder, include_hidden, limit, offset }) => {
      const allowedPath = await readFilter();
      const tree = await vault.listTree();
      const v = include_hidden === true ? undefined : index.visibility;
      // Filter notes by per-folder read perm (V52).
      const allowedNotes = tree.notes.filter((n) => allowedPath(n) && !v?.isHidden(n));
      const allowedFolders = tree.folders.filter((f) => {
        if (v?.isFolderHidden(f)) return false;
        // a folder is visible if its own (or any descendant note's) perm
        // is read=true; cheapest approximation = check resolveFolderPerms
        // on the folder path itself
        return allowedPath(`${f}/.md`);
      });
      // A folder argument means that folder and what is inside it, not every
      // path that merely starts with the same letters ("work" vs "workshop").
      const base = folder?.replace(/\/+$/, "");
      const inside = (p: string) => !base || p === base || p.startsWith(`${base}/`);
      const notes = allowedNotes.filter(inside);
      const p = paginate(notes, limit, offset, 100);
      const body = {
        folders: p.offset === 0 ? allowedFolders.filter(inside) : [],
        notes: p.items,
        total_notes: p.total,
        next_offset: p.nextOffset,
      };
      logCall("list_notes", { folder, limit, offset }, true);
      return pageContent("list_notes", body, p, "notes");
    },
  );

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
        "Syntax it cannot run comes back as `warnings`, not an error. 50 rows per page (`limit`, `offset`); cells are cut at 500 characters and a page stops at about 200 KB. Hidden notes are skipped.",
      inputSchema: {
        base: z.string().min(1).max(100_000).optional(),
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
        if (simple && view !== undefined) throw coded("INVALID_ARGUMENT", "view applies to base or path, not to filter / columns / sort.");
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
          if (view && !hit) throw coded("NOT_FOUND", `${path} has no view named "${view}"`);
          source = (hit ?? fences[0]!).source;
          thisPath = path;
        } else {
          source = simpleBase({ filter, columns, sort });
        }
        const allowed = await readFilter();
        const types = new Map((await listProperties(vault, index, allowed)).map((p) => [p.name, p.type] as const));
        const res = runBaseQuery(
          { source, view: simple ? undefined : view, thisPath, offset: 0, limit: 2000 },
          { index: queryIndexFor(index, visibility), allowed, types },
        );
        const grouped = res.groups.some((g) => g.label !== "");
        const rows = res.groups.flatMap((g) =>
          g.rows.map((r) => ({ path: r.path, title: r.title, ...(grouped ? { group: g.label } : {}), values: r.values })),
        );
        const start = Math.min(offset ?? 0, rows.length);
        const cap = limit ?? 50;
        let cut = 0;
        const clip = (v: unknown): unknown => {
          if (typeof v === "string" && v.length > QUERY_CELL_CHARS) {
            cut++;
            return v.slice(0, QUERY_CELL_CHARS) + "…";
          }
          return Array.isArray(v) ? v.map(clip) : v;
        };
        const items: typeof rows = [];
        let bytes = 0;
        let budgetHit = false;
        for (const r of rows.slice(start, start + cap)) {
          const row = { ...r, values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, clip(v)])) } as typeof r;
          const size = JSON.stringify(row).length;
          if (items.length > 0 && bytes + size > QUERY_REPLY_BYTES) {
            budgetHit = true;
            break;
          }
          bytes += size;
          items.push(row);
        }
        const end = start + items.length;
        const p = { items, total: rows.length, offset: start, nextOffset: end < rows.length ? end : null };
        const warnings = [...res.warnings];
        if (res.total > rows.length) warnings.push(`Only the first ${rows.length} of ${res.total} rows can be paged; narrow the query.`);
        if (cut > 0) warnings.push(`${cut} cell(s) longer than ${QUERY_CELL_CHARS} characters were cut.`);
        if (budgetHit) warnings.push(`The page was shortened to ${items.length} rows to keep the reply small; continue at offset=${end}.`);
        logCall("query_notes", args, true);
        return pageContent("query_notes", { view: res.view, views: res.views, columns: res.columns, total: res.total, warnings, rows: p.items }, p, "rows");
      } catch (err) {
        return toolError("query_notes", args, err);
      }
    },
  );

  server.registerTool(
    "graph_view",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "Graph of notes and their wikilinks. With `center`, only the notes within `depth` hops (default 1) of that note; with `folder`, only notes in that folder. Returns a short summary (counts, most linked notes); hosts with MCP Apps show it as an interactive graph.",
      inputSchema: {
        center: z.string().min(1).optional(),
        depth: z.number().int().min(1).max(3).optional(),
        folder: z.string().optional(),
      },
      ...graphToolMeta(views),
    },
    async ({ center, depth, folder }) => {
      const args = { center, depth, folder };
      try {
        if (center) await checkRead(vault, principal, center);
        let g = buildGraph(index, await readFilter());
        if (folder) {
          const prefix = folder.replace(/^\/+|\/+$/g, "");
          const inFolder = new Set(g.nodes.filter((n) => n.id === prefix || n.id.startsWith(`${prefix}/`)).map((n) => n.id));
          g = { nodes: g.nodes.filter((n) => inFolder.has(n.id)), links: g.links.filter((l) => inFolder.has(l.source) && inFolder.has(l.target)) };
        }
        if (center) g = neighbourhood(g, center, depth ?? 1);
        const scope = center ? `${center} (${depth ?? 1} hop${(depth ?? 1) > 1 ? "s" : ""})` : folder ? `folder ${folder}` : "the vault";
        logCall("graph_view", args, true);
        const result = { content: [{ type: "text", text: graphSummary(g, scope) }] };
        if (!views.graph) return result;
        const truncated = g.nodes.length > GRAPH_VIEW_MAX_NODES;
        const nodes = truncated ? g.nodes.slice(0, GRAPH_VIEW_MAX_NODES) : g.nodes;
        const kept = new Set(nodes.map((n) => n.id));
        const data = { nodes, links: g.links.filter((l) => kept.has(l.source) && kept.has(l.target)), center: center ?? null, truncated };
        return { ...result, _meta: { [GRAPH_VIEW_META_KEY]: data } };
      } catch (err) {
        return toolError("graph_view", args, err);
      }
    },
  );

  server.registerTool(
    "get_backlinks",
    {
      annotations: READ_ONLY_LOCAL,
      description: "Backlinks for a given note path, 50 per page by default (`limit`, `offset` for more).",
      inputSchema: { path: z.string().min(1), ...pageArgs(50, 500) },
    },
    async ({ path, limit, offset }) => {
      try {
        await checkRead(vault, principal, path);
        const allowedPath = await readFilter();
        const p = paginate(index.backlinks(path, allowedPath), limit, offset, 50);
        logCall("get_backlinks", { path, limit, offset }, true);
        return pageContent("get_backlinks", p.items, p, "backlinks");
      } catch (err) {
        return toolError("get_backlinks", { path }, err);
      }
    },
  );

  server.registerTool(
    "list_tags",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "Tags in the vault with usage counts, most used first, 100 per page by default (`limit`, `offset` for more).",
      inputSchema: { ...pageArgs(100, 1000) },
    },
    async ({ limit, offset }) => {
      const allowedPath = await readFilter();
      const tags = index.allTags(allowedPath).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
      const p = paginate(tags, limit, offset, 100);
      logCall("list_tags", { limit, offset }, true);
      return pageContent("list_tags", p.items, p, "tags");
    },
  );

  server.registerTool(
    "current_datetime",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "Server's current date, time, and timezone. Use this when you need absolute time orientation — many agents lose track of the date across long sessions or when invoked from a stale system prompt.",
      inputSchema: {},
    },
    async () => {
      const now = new Date();
      const iso = now.toISOString();
      const tz =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const human = now.toLocaleString("en-GB", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: tz,
        timeZoneName: "short",
      });
      const payload = {
        iso,
        unix_ms: now.getTime(),
        unix_s: Math.floor(now.getTime() / 1000),
        timezone: tz,
        human,
      };
      logCall("current_datetime", {}, true);
      return { content: [{ type: "text", text: JSON.stringify(payload) }] };
    },
  );

  server.registerTool(
    "get_tasks",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "Tasks (checkboxes) across the vault, 50 per page by default (`limit`, `offset` for more). `filter`: open, done or all (default).",
      inputSchema: { filter: z.enum(["open", "done", "all"]).optional(), ...pageArgs(50, 500) },
    },
    async ({ filter, limit, offset }) => {
      const allowedPath = await readFilter();
      const tasks = collectTasks(index).filter((t) => allowedPath(t.path));
      const f = filter ?? "all";
      const out =
        f === "open"
          ? tasks.filter((t) => !t.done)
          : f === "done"
            ? tasks.filter((t) => t.done)
            : tasks;
      const p = paginate(out, limit, offset, 50);
      logCall("get_tasks", { filter: f, limit, offset }, true);
      return pageContent("get_tasks", p.items, p, "tasks");
    },
  );

  server.registerTool(
    "write_note",
    {
      annotations: WRITE_NOTE_ANNOTATIONS,
      description:
        "Create or overwrite a note. Content is full body. To avoid overwriting someone else's edit, " +
        "pass base_revision: the `revision` read_note returned. If the note changed since, nothing is " +
        "written and you get code CONFLICT with the current revision: read_note again, merge, retry. " +
        "create_only: true refuses to overwrite an existing note.",
      ...MODEL_ONLY_META,
      inputSchema: {
        path: z.string().min(1),
        content: z.string(),
        base_revision: z.string().min(1).optional(),
        create_only: z.boolean().optional(),
      },
    },
    async ({ path, content, base_revision, create_only }) => {
      try {
        await checkWrite(vault, principal, path);
        // Conflict replies carry the current revision; only readers get one.
        if (base_revision !== undefined || create_only) await checkRead(vault, principal, path);
        const base = create_only ? null : base_revision;
        const checked = await vault.writeNoteChecked(path, content, base);
        if (!checked.ok) {
          throw create_only && checked.revision !== null
            ? Object.assign(new Error(`${path} already exists (revision ${checked.revision})`), { code: "CONFLICT" })
            : new NoteConflictError(path, checked.revision);
        }
        const r = checked.data;
        logCall("write_note", { path, bytes: content.length }, true);
        // write_note replaces the whole body with content the caller just
        // sent us, so echoing it back discloses nothing new, unlike
        // append_note, which would otherwise hand back pre-existing content
        // the caller may not have read permission for.
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...r }) }] };
      } catch (err) {
        return toolError("write_note", { path, bytes: content.length }, err);
      }
    },
  );

  server.registerTool(
    "update_properties",
    {
      annotations: UPDATE_PROPERTIES_ANNOTATIONS,
      description:
        "Change frontmatter properties of an existing note without rewriting it. `set` maps names to new " +
        "values (string, number, boolean, null, list or map; a new name is added, an existing one replaced) " +
        "and `unset` lists names to remove. Only the touched lines change: comments, key order and the " +
        "other properties stay as they are. Fails with INVALID_YAML if the note's frontmatter does not " +
        "parse. Pass base_revision (from read_note) to refuse the edit if the note changed since; you " +
        "then get code CONFLICT with the current revision.",
      ...MODEL_ONLY_META,
      inputSchema: {
        path: z.string().min(1),
        set: z.record(z.string(), z.unknown()).optional(),
        unset: z.array(z.string()).optional(),
        base_revision: z.string().min(1).optional(),
      },
    },
    async ({ path, set, unset, base_revision }) => {
      try {
        await checkWrite(vault, principal, path);
        // A revision, or a YAML error quoting the source, is only for callers who can read the note.
        if (base_revision !== undefined) await checkRead(vault, principal, path);
        const canRead = await mayRead(principal, path, await readPerms(vault));
        const r = await updateProperties(vault, path, { set, unset, baseRevision: base_revision }, canRead);
        logCall("update_properties", { path, set: Object.keys(set ?? {}), unset }, true);
        return {
          content: [
            { type: "text", text: JSON.stringify({ ok: true, path: r.path, mtime: r.mtime, ...(canRead ? { revision: r.revision } : {}) }) },
          ],
        };
      } catch (err) {
        return toolError("update_properties", { path }, err);
      }
    },
  );

  server.registerTool(
    "append_note",
    {
      annotations: APPEND_NOTE_ANNOTATIONS,
      description:
        "Append a paragraph to an existing note (ensures a blank-line separator). " +
        "Returns only path/mtime, never the resulting body, call read_note " +
        "separately if you also have read permission on this note. Concurrent appends never " +
        "lose each other's text; pass base_revision (from read_note) if your text only makes " +
        "sense after the content you read, and you get code CONFLICT if it changed.",
      ...MODEL_ONLY_META,
      inputSchema: {
        path: z.string().min(1),
        content: z.string().min(1),
        base_revision: z.string().min(1).optional(),
      },
    },
    async ({ path, content, base_revision }) => {
      try {
        await checkWrite(vault, principal, path);
        // V-concurrency #10: appendNote reads+writes under a per-path lock,
        // so two concurrent appends can't both read the same body and have
        // the second write clobber the first's addition.
        // A revision is only meaningful to someone who can read the note,
        // and the conflict reply carries the current one: write-only callers
        // must not get a hash they can test guesses against.
        if (base_revision !== undefined) await checkRead(vault, principal, path);
        const r = await vault.appendNote(path, content, base_revision);
        logCall("append_note", { path, bytes: content.length }, true);
        // Metadata only, a write-only folder (read:false, write:true) must
        // not leak the pre-existing content this call just appended to.
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, path: r.path, mtime: r.mtime }) }],
        };
      } catch (err) {
        return toolError("append_note", { path, bytes: content.length }, err);
      }
    },
  );

  // ---------------- V54: RAG-derived tools ----------------

  // Carrying the principal lets queries.ts enforce this token's own
  // OAuth scope on every derived tool, not just the ones that happen to
  // call checkRead() themselves (semantic_outline, context_for_query,
  // find_orphans, weekly_digest, compare_notes previously didn't).
  const ragDeps: RagDeps = { vault, index, pipeline, ragEnabled, principal };

  server.registerTool(
    "find_similar_tasks",
    {
      annotations: READ_ONLY_RAG,
      description:
        "Semantic search across task lines (- [ ] / - [x]). Filter open/done/all.",
      inputSchema: {
        query: z.string().min(1),
        k: z.number().int().min(1).max(50).optional(),
        filter: z.enum(["open", "done", "all"]).optional(),
        scope: scopeSchema,
      },
    },
    async ({ query, k, filter, scope }) => {
      try {
        const hits = await qSimilarTasks(ragDeps, query, k ?? 10, filter ?? "open", scope);
        logCall("find_similar_tasks", { query, k, filter, scope }, true);
        return { content: [{ type: "text", text: JSON.stringify(hits) }] };
      } catch (err) {
        return toolError("find_similar_tasks", { query, k, filter, scope }, err);
      }
    },
  );

  server.registerTool(
    "find_related",
    {
      annotations: READ_ONLY_RAG,
      description:
        "Notes semantically close to a given note path (excludes self). Optional `scope` confines results to one or more folders.",
      inputSchema: {
        path: z.string().min(1),
        k: z.number().int().min(1).max(20).optional(),
        scope: scopeSchema,
      },
    },
    async ({ path, k, scope }) => {
      try {
        await checkRead(vault, principal, path);
        const allowedPath = await readFilter();
        const raw = await qRelated(ragDeps, path, k ?? 5, scope);
        const hits = Array.isArray(raw)
          ? raw.filter((h: { path?: string }) => !h.path || allowedPath(h.path))
          : raw;
        logCall("find_related", { path, k, scope }, true);
        return { content: [{ type: "text", text: JSON.stringify(hits) }] };
      } catch (err) {
        return toolError("find_related", { path, k, scope }, err);
      }
    },
  );

  server.registerTool(
    "semantic_outline",
    {
      annotations: READ_ONLY_RAG,
      description:
        "Cluster a note's chunks into topical groups (cosine ≥ threshold). Returns one entry per cluster.",
      inputSchema: {
        path: z.string().min(1),
        threshold: z.number().min(0).max(1).optional(),
      },
    },
    async ({ path, threshold }) => {
      try {
        const clusters = await qOutline(ragDeps, path, threshold ?? 0.7);
        logCall("semantic_outline", { path, threshold }, true);
        return { content: [{ type: "text", text: JSON.stringify(clusters) }] };
      } catch (err) {
        return toolError("semantic_outline", { path, threshold }, err);
      }
    },
  );

  server.registerTool(
    "context_for_query",
    {
      annotations: READ_ONLY_RAG,
      description:
        "Pack top-relevant chunks into a markdown context block under a token budget. Returns text + sources + truncated flag.",
      inputSchema: {
        query: z.string().min(1),
        budget_tokens: z.number().int().min(64).max(16000).optional(),
        scope: scopeSchema,
      },
    },
    async ({ query, budget_tokens, scope }) => {
      try {
        const out = await qContext(ragDeps, query, budget_tokens ?? 2000, scope);
        logCall("context_for_query", { query, budget_tokens, scope }, true);
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      } catch (err) {
        return toolError("context_for_query", { query, budget_tokens, scope }, err);
      }
    },
  );

  server.registerTool(
    "find_orphans",
    {
      annotations: READ_ONLY_LOCAL,
      description:
        "Notes with zero backlinks AND low semantic neighbours (isolation = 1 - max cosine).",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        min_isolation: z.number().min(0).max(1).optional(),
        scope: scopeSchema,
      },
    },
    async ({ limit, min_isolation, scope }) => {
      try {
        const out = await qOrphans(ragDeps, limit ?? 10, min_isolation ?? 0.35, scope);
        logCall("find_orphans", { limit, min_isolation, scope }, true);
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      } catch (err) {
        return toolError("find_orphans", { limit, min_isolation, scope }, err);
      }
    },
  );

  server.registerTool(
    "weekly_digest",
    {
      annotations: READ_ONLY_RAG,
      description:
        "Topic clusters across notes modified in a recent window (e.g. '7d', '24h').",
      inputSchema: {
        since: z.string().optional(),
        threshold: z.number().min(0).max(1).optional(),
        scope: scopeSchema,
      },
    },
    async ({ since, threshold, scope }) => {
      try {
        const out = await qDigest(ragDeps, since ?? "7d", threshold ?? 0.6, scope);
        logCall("weekly_digest", { since, threshold, scope }, true);
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      } catch (err) {
        return toolError("weekly_digest", { since, threshold, scope }, err);
      }
    },
  );

  server.registerTool(
    "compare_notes",
    {
      annotations: READ_ONLY_RAG,
      description:
        "Compare two notes: cosine similarity of intros + naive unified diff + shared headings.",
      inputSchema: {
        a: z.string().min(1),
        b: z.string().min(1),
      },
    },
    async ({ a, b }) => {
      try {
        const out = await qCompare(ragDeps, a, b);
        logCall("compare_notes", { a, b }, true);
        return { content: [{ type: "text", text: JSON.stringify(out) }] };
      } catch (err) {
        return toolError("compare_notes", { a, b }, err);
      }
    },
  );

  // ---------------- resources ----------------

  for (const view of appResources(views)) {
    const { name, description, ...contents } = view;
    server.registerResource(name, view.uri, { description, mimeType: view.mimeType, _meta: view._meta }, async () => ({
      contents: [contents],
    }));
  }

  server.registerResource(
    "vault-tree",
    "vault://tree",
    {
      description: "Vault tree snapshot (folders + notes), filtered by MCP read perms",
      mimeType: "application/json",
    },
    async () => {
      const allowedPath = await readFilter();
      const tree = await vault.listTree();
      const notes = tree.notes.filter(allowedPath);
      return {
        contents: [
          {
            uri: "vault://tree",
            mimeType: "application/json",
            text: JSON.stringify({ folders: tree.folders, notes }),
          },
        ],
      };
    },
  );

  server.registerResource(
    "vault-note",
    new ResourceTemplate("vault://note/{+path}", { list: undefined }),
    {
      description: "Single note body by path (vault://note/<rel/path.md>)",
      mimeType: "text/markdown",
    },
    async (uri, vars) => {
      const path = String((vars as { path?: string }).path ?? "");
      await checkRead(vault, principal, path);
      const note = await vault.readNote(path);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: note.content,
          },
        ],
      };
    },
  );

}

// Stateless transport: every JSON-RPC request gets a one-shot JSON
// response. No session tracking, no SSE stream. This is the only mode
// that survives clients that open/close transports per call (LM Studio,
// Claude Desktop, the @modelcontextprotocol/inspector REPL). The SDK
// requires a fresh Server + Transport pair per request in this mode.
//
// Trade-off: server→client notifications (resources/list changed,
// tools/list changed, log forwards) won't reach the client. brain.md's
// tools don't emit those today, so this is invisible to users.
export function createMcp(deps: McpDeps) {
  const loader = deps.loadView ?? (async () => null);
  let views: AppViews | undefined;
  const getViews = async (): Promise<AppViews> => {
    if (views && (views.note || views.graph)) return views;
    views = await loadViews(loader);
    return views;
  };
  return {
    handleRequest: async (request: Request): Promise<Response> => {
      // V68: owner-editable, vault-scoped instructions surfaced to the model
      // via the MCP initialize response. Read per request so edits to
      // <VAULT>/.brain/mcp-prompt.md take effect without a server restart.
      const instructions = await loadMcpInstructions(deps.vault);
      const server = new McpServer(
        { name: "brain.md", version: VERSION },
        instructions ? { instructions } : undefined,
      );
      registerHandlers(server, deps, principalFor(request), await getViews());
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      return transport.handleRequest(request);
    },
  };
}

export function mcpRoutes(mcp: ReturnType<typeof createMcp>) {
  const handle = async ({ request }: { request: Request }) =>
    mcp.handleRequest(request);
  // Mount both no-slash and with-slash so clients that normalize either
  // way (LM Studio appends '/', Claude Desktop omits it) both land here.
  return new Elysia().all("/mcp", handle).all("/mcp/", handle);
}
