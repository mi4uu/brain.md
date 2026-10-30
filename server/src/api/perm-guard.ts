import type { Vault } from "../vault/vault";
import { loadFolderMeta, resolveFolderPerms } from "./folder-perms";
import { principalFor } from "./auth-middleware";
import {
  principalCanRead,
  principalCanWrite,
  bypassesFolderPerms,
  isOwnerPrincipal,
} from "./principal";
import { normalizeRel } from "../vault/paths";
import { VaultError } from "../vault/types";

// REST equivalent of mcp/server.ts's checkRead/checkWrite. A long-lived API
// key or OAuth token authenticates the same way on /api/* as it does on
// /mcp/* (auth-middleware.ts), so it must be held to the same per-folder
// permissions here, otherwise the folder restrictions an owner sets up for
// agents are MCP-only decoration, defeated by pointing the same credential
// at the HTTP API instead. An owner (password-login) session keeps full
// access everywhere.

async function check(
  vault: Vault,
  request: Request,
  path: string,
  kind: "read" | "write",
): Promise<void> {
  const principal = principalFor(request);
  const can = kind === "read" ? principalCanRead(principal) : principalCanWrite(principal);
  if (!can) {
    throw new VaultError(`${kind} denied: token scope does not include vault:${kind}`, "FORBIDDEN");
  }
  if (bypassesFolderPerms(principal)) return;
  const meta = await loadFolderMeta(vault);
  const perms = resolveFolderPerms(path, meta.mcp);
  if (kind === "read" ? !perms.read : !perms.write) {
    throw new VaultError(`${kind} denied for ${path} by folder permissions`, "FORBIDDEN");
  }
}

export const requireRead = (vault: Vault, request: Request, path: string): Promise<void> =>
  check(vault, request, path, "read");

export const requireWrite = (vault: Vault, request: Request, path: string): Promise<void> =>
  check(vault, request, path, "write");

// Per-path read predicate for list/search-style routes, built once per
// request and reused across every candidate path.
export async function readFilterFor(
  vault: Vault,
  request: Request,
): Promise<(path: string) => boolean> {
  const principal = principalFor(request);
  if (!principalCanRead(principal)) return () => false;
  if (bypassesFolderPerms(principal)) return () => true;
  const meta = await loadFolderMeta(vault);
  return (path: string) => resolveFolderPerms(path, meta.mcp).read;
}

// Same shape, for write. Used by rename to decide whether a candidate
// backlink file may be rewritten by this principal.
export async function writeFilterFor(
  vault: Vault,
  request: Request,
): Promise<(path: string) => boolean> {
  const principal = principalFor(request);
  if (!principalCanWrite(principal)) return () => false;
  if (bypassesFolderPerms(principal)) return () => true;
  const meta = await loadFolderMeta(vault);
  return (path: string) => resolveFolderPerms(path, meta.mcp).write;
}

// Endpoints that administer the server (folder MCP permissions, settings,
// API keys, the password, OAuth client admin) require the owner: a
// password-login session, or the back-compat "no password configured"
// principal. API keys and OAuth tokens, agent credentials, get 403,
// even though they're otherwise allowed on /api/*.
export function requireOwner(request: Request): void {
  const principal = principalFor(request);
  if (!isOwnerPrincipal(principal)) {
    throw new VaultError(
      "owner session required: API keys and OAuth tokens cannot administer the server",
      "FORBIDDEN",
    );
  }
}

// Folder delete removes every note underneath it in one call; an agent
// credential restricted from writing some of those notes individually
// must not be able to destroy them by deleting an ancestor folder instead.
// Checks the folder itself plus every note and subfolder under it.
export async function requireWriteSubtree(
  vault: Vault,
  request: Request,
  rel: string,
): Promise<void> {
  const principal = principalFor(request);
  if (!principalCanWrite(principal)) {
    throw new VaultError("write denied: token scope does not include vault:write", "FORBIDDEN");
  }
  if (bypassesFolderPerms(principal)) return;
  const meta = await loadFolderMeta(vault);
  const norm = normalizeRel(rel);
  const canWriteUnder = (path: string) => resolveFolderPerms(path, meta.mcp).write;
  // resolveFolderPerms expects a note-shaped path (it walks up from the
  // path's *parent*), so a folder is checked via a synthetic child path,
  // same trick mcp/server.ts's list_notes uses for folder visibility.
  if (!canWriteUnder(`${norm}/.probe`)) {
    throw new VaultError(`write denied for ${norm} by folder permissions`, "FORBIDDEN");
  }
  const { notes, folders } = await vault.listTree();
  const prefix = `${norm}/`;
  const inSubtree = (p: string) => p === norm || p.startsWith(prefix);
  for (const n of notes.filter(inSubtree)) {
    if (!canWriteUnder(n)) {
      throw new VaultError(`write denied for ${n} by folder permissions`, "FORBIDDEN");
    }
  }
  for (const f of folders.filter(inSubtree)) {
    if (!canWriteUnder(`${f}/.probe`)) {
      throw new VaultError(`write denied for ${f} by folder permissions`, "FORBIDDEN");
    }
  }
}
