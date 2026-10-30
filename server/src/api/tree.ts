import { Elysia } from "elysia";
import type { Vault } from "../vault/vault";
import { asError } from "./errors";
import { readFilterFor } from "./perm-guard";

export function treeRoutes(vault: Vault) {
  return new Elysia({ prefix: "/api" }).get("/tree", async ({ set, request }) => {
    try {
      const allowed = await readFilterFor(vault, request);
      const tree = await vault.listTree();
      return {
        folders: tree.folders.filter((f) => allowed(`${f}/.md`)),
        notes: tree.notes.filter(allowed),
      };
    } catch (e) {
      const { status, body } = asError(e);
      set.status = status;
      return body;
    }
  });
}
