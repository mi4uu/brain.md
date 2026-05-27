import { Elysia, t } from "elysia";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";
import { normalizeRel, parentDir } from "../vault/paths";
import { asError } from "./errors";
import { decodeWildcard } from "./wildcard";

// V52: per-folder MCP permissions.
// Stored alongside icons/colors in <VAULT>/.brain/folder-meta.json under
// the `mcp.<folder-path>` key. Resolution walks the note's parent
// folder chain to root, nearest explicit override wins; default rw.

const META_REL = ".brain/folder-meta.json";

export interface McpFolderPerms {
  read: boolean;
  write: boolean;
}

export interface FolderMetaWithMcp {
  version: 1;
  icons: Record<string, string>;
  colors: Record<string, string>;
  mcp: Record<string, McpFolderPerms>;
}

export const DEFAULT_MCP_PERMS: McpFolderPerms = { read: true, write: true };

export async function loadFolderMeta(vault: Vault): Promise<FolderMetaWithMcp> {
  try {
    const raw = await readFile(vault.abs(META_REL), "utf8");
    const parsed = JSON.parse(raw) as Partial<FolderMetaWithMcp>;
    return {
      version: 1,
      icons: parsed.icons ?? {},
      colors: parsed.colors ?? {},
      mcp: normalizeMcpMap(parsed.mcp),
    };
  } catch {
    return { version: 1, icons: {}, colors: {}, mcp: {} };
  }
}

function normalizeMcpMap(
  raw: Record<string, McpFolderPerms> | undefined,
): Record<string, McpFolderPerms> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, McpFolderPerms> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!v || typeof v !== "object") continue;
    out[k] = {
      read: typeof v.read === "boolean" ? v.read : true,
      write: typeof v.write === "boolean" ? v.write : true,
    };
  }
  return out;
}

async function saveFolderMeta(
  vault: Vault,
  meta: FolderMetaWithMcp,
): Promise<void> {
  const abs = vault.abs(META_REL);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(meta, null, 2));
  try {
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

// V52: walk ancestors from note's parent folder up to root, return the
// nearest explicit override; default rw.
export function resolveFolderPerms(
  notePath: string,
  mcpMap: Record<string, McpFolderPerms>,
): McpFolderPerms {
  let dir = parentDir(normalizeRel(notePath));
  while (true) {
    const override = mcpMap[dir];
    if (override) return override;
    if (dir === "") break;
    dir = parentDir(dir);
  }
  return DEFAULT_MCP_PERMS;
}

export function folderPermsRoutes(vault: Vault) {
  return new Elysia()
    .get("/api/folder-mcp-perms", async () => {
      const meta = await loadFolderMeta(vault);
      return meta.mcp;
    })
    .post(
      "/api/folder-mcp-perms",
      async ({ body, set }) => {
        try {
          const meta = await loadFolderMeta(vault);
          const norm = normalizeRel(body.path);
          if (norm === "") {
            // root override allowed — useful for "deny all by default"
          }
          meta.mcp[norm] = {
            read: !!body.read,
            write: !!body.write,
          };
          await saveFolderMeta(vault, meta);
          return { ok: true, mcp: meta.mcp };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          path: t.String(),
          read: t.Boolean(),
          write: t.Boolean(),
        }),
      },
    )
    .delete("/api/folder-mcp-perms/*", async ({ params, set }) => {
      try {
        const rel = decodeWildcard((params as { "*": string })["*"]);
        const meta = await loadFolderMeta(vault);
        const norm = normalizeRel(rel);
        delete meta.mcp[norm];
        await saveFolderMeta(vault, meta);
        return { ok: true, mcp: meta.mcp };
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    });
}
