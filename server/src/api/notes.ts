import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { asError } from "./errors";
import { decodeWildcard } from "./wildcard";
import { requireRead, requireWrite } from "./perm-guard";

export function noteRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api/note" })
    .get("/*", async ({ params, set, request }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        await requireRead(vault, request, rel);
        return await vault.readNote(rel);
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    })
    .put(
      "/*",
      async ({ params, body, set, request }) => {
        const rel = decodeWildcard((params as { "*": string })["*"]);
        try {
          await requireWrite(vault, request, rel);
          const data = await vault.writeNote(rel, body.content);
          await index.updatePath(rel);
          return { path: data.path, mtime: data.mtime };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      { body: t.Object({ content: t.String() }) },
    )
    .delete("/*", async ({ params, set, request }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        await requireWrite(vault, request, rel);
        const trashed = await vault.deleteNote(rel);
        index.remove(rel);
        return { ok: true, trashed };
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    });
}
