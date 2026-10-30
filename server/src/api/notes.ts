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
          const r = await vault.writeNoteChecked(rel, body.content, body.baseRevision);
          if (!r.ok) {
            set.status = 409;
            return { code: "CONFLICT", revision: r.revision };
          }
          return { path: r.data.path, mtime: r.data.mtime, revision: r.data.revision };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      { body: t.Object({ content: t.String(), baseRevision: t.Optional(t.String()) }) },
    )
    .delete("/*", async ({ params, set, request }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        await requireWrite(vault, request, rel);
        const trashed = await vault.deleteNote(rel);
        return { ok: true, trashed };
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    });
}
