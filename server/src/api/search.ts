import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { search } from "../index/search";
import { readFilterFor } from "./perm-guard";

export function searchRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api" }).get(
    "/search",
    async ({ query, request }) => {
      const allowed = await readFilterFor(vault, request);
      return search(index, query.q ?? "", undefined, allowed);
    },
    { query: t.Object({ q: t.Optional(t.String()) }) },
  );
}
