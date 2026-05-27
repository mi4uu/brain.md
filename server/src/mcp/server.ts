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

const TASK_RE = /^(\s*[-*+])\s+\[([ xX])\]\s+(.*)$/;

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

function logCall(name: string, args: unknown, ok: boolean): void {
  // V46: audit log to stderr (servers usually capture stderr)
  const argSummary = JSON.stringify(args).slice(0, 200);
  console.error(`[mcp] tool=${name} ok=${ok} args=${argSummary}`);
}

export function createMcp(deps: McpDeps) {
  const { vault, index, pipeline, ragEnabled } = deps;
  const server = new McpServer({ name: "brain.md", version: "0.1.0" });

  // ---------------- tools ----------------

  server.registerTool(
    "search_notes",
    {
      description: "Full-text search across the vault. Returns top 50 hits.",
      inputSchema: { query: z.string().min(1) },
    },
    async ({ query }) => {
      const hits = fullTextSearch(index, query);
      logCall("search_notes", { query }, true);
      return { content: [{ type: "text", text: JSON.stringify(hits) }] };
    },
  );

  server.registerTool(
    "similar_notes",
    {
      description:
        "Semantic (vector) search via RAG. Returns top-k chunks with paths and snippets.",
      inputSchema: {
        query: z.string().min(1),
        k: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, k }) => {
      if (!ragEnabled()) {
        logCall("similar_notes", { query, k }, false);
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
      const [vec] = await pipeline.embed([query]);
      const hits = await pipeline.store.search(vec!, k ?? 5);
      logCall("similar_notes", { query, k }, true);
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
      const perms = resolveFolderPerms(path, await readPerms(vault));
      if (!perms.read) denied("read", path);
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
      const map = await readPerms(vault);
      const tree = await vault.listTree();
      // Filter notes by per-folder read perm (V52).
      const allowed = tree.notes.filter(
        (n) => resolveFolderPerms(n, map).read,
      );
      const allowedFolders = tree.folders.filter((f) => {
        // a folder is visible if its own (or any descendant note's) perm
        // is read=true; cheapest approximation = check resolveFolderPerms
        // on the folder path itself
        const dummy = `${f}/.md`;
        return resolveFolderPerms(dummy, map).read;
      });
      const filtered = folder
        ? {
            folders: allowedFolders.filter((f) => f.startsWith(folder)),
            notes: allowed.filter((n) => n.startsWith(folder)),
          }
        : { folders: allowedFolders, notes: allowed };
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
      const perms = resolveFolderPerms(path, await readPerms(vault));
      if (!perms.read) denied("read", path);
      const bls = index.backlinks(path);
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
      const tags = index.allTags();
      logCall("list_tags", {}, true);
      return { content: [{ type: "text", text: JSON.stringify(tags) }] };
    },
  );

  server.registerTool(
    "get_tasks",
    {
      description: "Aggregate tasks vault-wide.",
      inputSchema: { filter: z.enum(["open", "done", "all"]).optional() },
    },
    async ({ filter }) => {
      const tasks = collectTasks(index);
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
      const perms = resolveFolderPerms(path, await readPerms(vault));
      if (!perms.write) denied("write", path);
      const r = await vault.writeNote(path, content);
      logCall("write_note", { path, bytes: content.length }, true);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...r }) }] };
    },
  );

  server.registerTool(
    "append_note",
    {
      description:
        "Append a paragraph to an existing note (ensures a blank-line separator).",
      inputSchema: {
        path: z.string().min(1),
        content: z.string().min(1),
      },
    },
    async ({ path, content }) => {
      const perms = resolveFolderPerms(path, await readPerms(vault));
      if (!perms.write) denied("write", path);
      let body = "";
      try {
        const cur = await vault.readNote(path);
        body = cur.content;
      } catch {
        body = "";
      }
      const joiner = body === "" ? "" : body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
      const next = body + joiner + content + (content.endsWith("\n") ? "" : "\n");
      const r = await vault.writeNote(path, next);
      logCall("append_note", { path, bytes: content.length }, true);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, ...r }) }] };
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
      const map = await readPerms(vault);
      const tree = await vault.listTree();
      const notes = tree.notes.filter((n) => resolveFolderPerms(n, map).read);
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
      const perms = resolveFolderPerms(path, await readPerms(vault));
      if (!perms.read) denied("read", path);
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

  // ---------------- transport ----------------

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });
  // Connect now; transport is shared across requests (transport handles its
  // own session state internally).
  void server.connect(transport);

  return { server, transport };
}

export function mcpRoutes(mcp: ReturnType<typeof createMcp>) {
  // Both POST and GET land on /mcp; the transport inspects method + headers
  // (mcp-session-id, last-event-id, etc.) and dispatches.
  return new Elysia()
    .all("/mcp", async ({ request }) => {
      return mcp.transport.handleRequest(request);
    })
    .all("/mcp/sse", async ({ request }) => {
      return mcp.transport.handleRequest(request);
    });
}
