import { Elysia } from "elysia";
import type { Vault } from "../vault/vault";
import { asError } from "./errors";
import { decodeWildcard } from "./wildcard";

export function folderRoutes(vault: Vault) {
  return new Elysia({ prefix: "/api/folder" })
    .post("/*", async ({ params, set }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        await vault.mkdirFolder(rel);
        return { ok: true };
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    })
    .delete("/*", async ({ params, set }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        const trashed = await vault.deleteFolder(rel);
        return { ok: true, trashed };
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    });
}
