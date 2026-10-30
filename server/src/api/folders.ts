import { Elysia } from "elysia";
import type { Vault } from "../vault/vault";
import { asError } from "./errors";
import { decodeWildcard } from "./wildcard";
import { requireWrite, requireWriteSubtree } from "./perm-guard";

export function folderRoutes(vault: Vault) {
  return new Elysia({ prefix: "/api/folder" })
    .post("/*", async ({ params, set, request }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        // A new, empty folder: checking write on the target path itself
        // (via the same synthetic-child trick folder visibility uses) is
        // enough, there's nothing underneath it yet.
        await requireWrite(vault, request, `${rel}/.probe`);
        await vault.mkdirFolder(rel);
        return { ok: true };
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    })
    .delete("/*", async ({ params, set, request }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        // Deleting a folder deletes everything under it in one call; an
        // agent credential restricted from writing some of those notes
        // individually must not be able to destroy them this way instead.
        await requireWriteSubtree(vault, request, rel);
        const trashed = await vault.deleteFolder(rel);
        return { ok: true, trashed };
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    });
}
