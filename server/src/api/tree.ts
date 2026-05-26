import { Elysia } from "elysia";
import type { Vault } from "../vault/vault";
import { asError } from "./errors";

export function treeRoutes(vault: Vault) {
  return new Elysia({ prefix: "/api" }).get("/tree", async ({ set }) => {
    try {
      return await vault.listTree();
    } catch (e) {
      const { status, body } = asError(e);
      set.status = status;
      return body;
    }
  });
}
