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
import type { Vault } from "../vault/vault";
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
import { loadMcpInstructions } from "./instructions";
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
  type RagDeps,
} from "../rag/queries";

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
  pipeline: RagPipeline;
  ragEnabled: () => boolean;
}

async function readPerms(vault: Vault): Promise<Record<string, McpFolderPerms>> {
  const meta = await loadFolderMeta(vault);
  return meta.mcp;
}

function denied(perm: "read" | "write", path: string): never {
  const e: Error & { code?: string } = new Error(
    `[mcp] ${perm} denied for ${path} by folder permissions (V52)`,
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

// MCP clients (Claude Desktop, LM Studio, …) open and close transports
// at will. The SDK's stateless mode requires a NEW Server + Transport
// per request, so we extract handler registration here and rebuild
// both objects on every /mcp request inside mcpRoutes() below.
function registerHandlers(server: McpServer, deps: McpDeps, principal: Principal): void {
  const { vault, index, pipeline, ragEnabled } = deps;

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
      description:
        "Full-text search across the vault. Returns top 50 hits. Optional `scope` confines the search to one or more folders.",
      inputSchema: { query: z.string().min(1), scope: scopeSchema },
    },
    async ({ query, scope }) => {
      const allowed = await readFilter();
      const hits = fullTextSearch(index, query, scope, allowed);
      logCall("search_notes", { query, scope }, true);
      return { content: [{ type: "text", text: JSON.stringify(hits) }] };
    },
  );

  server.registerTool(
    "similar_notes",
    {
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
      const total = await pipeline.store.countAll().catch(() => 0);
      if (total === 0) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "index building",
                indexed: 0,
                total,
              }),
            },
          ],
        };
      }
      const prefixes = normalizeScope(scope);
      const limit = k ?? 5;
      const [vec] = await pipeline.embed([query]);
      const allowed = await readFilter();
      // Over-fetch so enough in-scope, permitted hits survive both filters.
      const needsOverfetch = prefixes.length > 0 || !bypassesFolderPermsForMcp(principal);
      const raw = await pipeline.store.search(
        vec!,
        needsOverfetch ? limit + 50 : limit,
      );
      const hits = raw
        .filter((h) => inScope(h.path, prefixes))
        .filter((h) => allowed(h.path))
        .slice(0, limit);
      logCall("similar_notes", { query, k, scope }, true);
      return { content: [{ type: "text", text: JSON.stringify(hits) }] };
    },
  );

  server.registerTool(
    "read_note",
    {
      description: "Read a single note. Returns content + mtime.",
      inputSchema: { path: z.string().min(1) },
    },
    async ({ path }) => {
      await checkRead(vault, principal, path);
      const note = await vault.readNote(path);
      logCall("read_note", { path }, true);
      return {
        content: [{ type: "text", text: JSON.stringify(note) }],
      };
    },
  );

  server.registerTool(
    "list_notes",
    {
      description: "List all notes (and folders) in the vault.",
      inputSchema: { folder: z.string().optional() },
    },
    async ({ folder }) => {
      const allowedPath = await readFilter();
      const tree = await vault.listTree();
      // Filter notes by per-folder read perm (V52).
      const allowedNotes = tree.notes.filter(allowedPath);
      const allowedFolders = tree.folders.filter((f) => {
        // a folder is visible if its own (or any descendant note's) perm
        // is read=true; cheapest approximation = check resolveFolderPerms
        // on the folder path itself
        return allowedPath(`${f}/.md`);
      });
      const filtered = folder
        ? {
            folders: allowedFolders.filter((f) => f.startsWith(folder)),
            notes: allowedNotes.filter((n) => n.startsWith(folder)),
          }
        : { folders: allowedFolders, notes: allowedNotes };
      logCall("list_notes", { folder }, true);
      return { content: [{ type: "text", text: JSON.stringify(filtered) }] };
    },
  );

  server.registerTool(
    "get_backlinks",
    {
      description: "Backlinks for a given note path.",
      inputSchema: { path: z.string().min(1) },
    },
    async ({ path }) => {
      await checkRead(vault, principal, path);
      const allowedPath = await readFilter();
      const bls = index.backlinks(path, allowedPath);
      logCall("get_backlinks", { path }, true);
      return { content: [{ type: "text", text: JSON.stringify(bls) }] };
    },
  );

  server.registerTool(
    "list_tags",
    {
      description: "All tags in the vault with usage counts.",
      inputSchema: {},
    },
    async () => {
      const allowedPath = await readFilter();
      const tags = index.allTags(allowedPath);
      logCall("list_tags", {}, true);
      return { content: [{ type: "text", text: JSON.stringify(tags) }] };
    },
  );

  server.registerTool(
    "current_datetime",
    {
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
      description: "Aggregate tasks vault-wide.",
      inputSchema: { filter: z.enum(["open", "done", "all"]).optional() },
    },
    async ({ filter }) => {
      const allowedPath = await readFilter();
      const tasks = collectTasks(index).filter((t) => allowedPath(t.path));
      const f = filter ?? "all";
      const out =
        f === "open"
          ? tasks.filter((t) => !t.done)
          : f === "done"
            ? tasks.filter((t) => t.done)
            : tasks;
      logCall("get_tasks", { filter: f }, true);
      return { content: [{ type: "text", text: JSON.stringify(out) }] };
    },
  );

  server.registerTool(
    "write_note",
    {
      description: "Create or overwrite a note. Content is full body.",
      inputSchema: {
        path: z.string().min(1),
        content: z.string(),
      },
    },
    async ({ path, content }) => {
      await checkWrite(vault, principal, path);
      const r = await vault.writeNote(path, content);
      logCall("write_note", { path, bytes: content.length }, true);
      // write_note replaces the whole body with content the caller just
      // sent us, so echoing it back discloses nothing new, unlike
      // append_note, which would otherwise hand back pre-existing content
      // the caller may not have read permission for.
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...r }) }] };
    },
  );

  server.registerTool(
    "append_note",
    {
      description:
        "Append a paragraph to an existing note (ensures a blank-line separator). " +
        "Returns only path/mtime, never the resulting body, call read_note " +
        "separately if you also have read permission on this note.",
      inputSchema: {
        path: z.string().min(1),
        content: z.string().min(1),
      },
    },
    async ({ path, content }) => {
      await checkWrite(vault, principal, path);
      // V-concurrency #10: appendNote reads+writes under a per-path lock,
      // so two concurrent appends can't both read the same body and have
      // the second write clobber the first's addition.
      const r = await vault.appendNote(path, content);
      logCall("append_note", { path, bytes: content.length }, true);
      // Metadata only, a write-only folder (read:false, write:true) must
      // not leak the pre-existing content this call just appended to.
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, path: r.path, mtime: r.mtime }) }],
      };
    },
  );

  // ---------------- V54: RAG-derived tools ----------------

  // Carrying the principal lets queries.ts enforce this token's own
  // OAuth scope on every derived tool, not just the ones that happen to
  // call checkRead() themselves (semantic_outline, context_for_query,
  // find_orphans, weekly_digest, compare_notes previously didn't).
  const ragDeps: RagDeps = { vault, index, pipeline, ragEnabled, principal };

  const ragError = (name: string, args: unknown, err: unknown) => {
    logCall(name, args, false);
    const isDisabled = err instanceof RagDisabledError;
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: isDisabled ? "RAG disabled" : (err instanceof Error ? err.message : String(err)),
            code: isDisabled ? "RAG_DISABLED" : "RAG_ERROR",
          }),
        },
      ],
    };
  };

  server.registerTool(
    "find_similar_tasks",
    {
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
        return ragError("find_similar_tasks", { query, k, filter, scope }, err);
      }
    },
  );

  server.registerTool(
    "find_related",
    {
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
        return ragError("find_related", { path, k, scope }, err);
      }
    },
  );

  server.registerTool(
    "semantic_outline",
    {
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
        return ragError("semantic_outline", { path, threshold }, err);
      }
    },
  );

  server.registerTool(
    "context_for_query",
    {
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
        return ragError("context_for_query", { query, budget_tokens, scope }, err);
      }
    },
  );

  server.registerTool(
    "find_orphans",
    {
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
        return ragError("find_orphans", { limit, min_isolation, scope }, err);
      }
    },
  );

  server.registerTool(
    "weekly_digest",
    {
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
        return ragError("weekly_digest", { since, threshold, scope }, err);
      }
    },
  );

  server.registerTool(
    "compare_notes",
    {
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
        return ragError("compare_notes", { a, b }, err);
      }
    },
  );

  // ---------------- resources ----------------

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
      registerHandlers(server, deps, principalFor(request));
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
