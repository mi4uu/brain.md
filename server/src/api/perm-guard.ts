import type { Vault } from "../vault/vault";
import { loadFolderMeta, resolveFolderPerms } from "./folder-perms";
import { principalFor } from "./auth-middleware";
import { principalCanRead, principalCanWrite, bypassesFolderPerms } from "./principal";
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
