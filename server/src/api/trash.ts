import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { TRASH_REL } from "../vault/vault";
import { normalizeRel } from "../vault/paths";
import { asError } from "./errors";
import { requireWrite, readFilterFor } from "./perm-guard";

// A trashed item's permission belongs to the folder it came from, not to
// .brain/trash/ itself — otherwise trash would be a way around a folder's
// write restriction (delete is a write; so is restoring).
function originalPathOf(trashPath: string): string | null {
  const norm = normalizeRel(trashPath);
  if (!norm.startsWith(`${TRASH_REL}/`)) return null;
  const tail = norm.slice(TRASH_REL.length + 1);
  const slash = tail.indexOf("/");
  return slash < 0 ? null : tail.slice(slash + 1);
}

export function trashRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api" })
    .get("/trash", async ({ request }) => {
      const allowed = await readFilterFor(vault, request);
      const entries = await vault.listTrash();
      return entries.filter((e) => {
        const original = originalPathOf(e.path);
        return original ? allowed(original) : true;
      });
    })
    .post(
      "/trash/restore",
      async ({ body, set, request }) => {
        try {
          const original = originalPathOf(body.trashPath);
          if (original) await requireWrite(vault, request, original);
          // index update flows from vault.restoreFromTrash's own
          // notify("write", ...) via VaultIndex.start() (see app.ts).
          const restored = await vault.restoreFromTrash(body.trashPath);
          return { ok: true, path: restored };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      { body: t.Object({ trashPath: t.String() }) },
    );
}
