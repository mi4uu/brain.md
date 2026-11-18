import { Elysia } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { asError } from "./errors";
import { readFilterFor } from "./perm-guard";

export function treeRoutes(vault: Vault, index?: VaultIndex) {
  return new Elysia({ prefix: "/api" }).get("/tree", async ({ set, request }) => {
    try {
      const allowed = await readFilterFor(vault, request);
      const tree = await vault.listTree();
      const folders = tree.folders.filter((f) => allowed(`${f}/.md`));
      const notes = tree.notes.filter(allowed);
      const v = index?.visibility;
      // Hidden items are listed separately so the UI can show them on
      // demand ("Show hidden") without a second request.
      return {
        folders,
        notes,
        hiddenNotes: v ? notes.filter((n) => v.isHidden(n)) : [],
        hiddenFolders: v ? folders.filter((f) => v.isFolderHidden(f)) : [],
        mtimes: Object.fromEntries(notes.map((n) => [n, index?.get(n)?.mtime ?? 0])),
      };
    } catch (e) {
      const { status, body } = asError(e);
      set.status = status;
      return body;
    }
  });
}
