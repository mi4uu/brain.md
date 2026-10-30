import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { readFilterFor } from "./perm-guard";

export function tagRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api/tags" })
    .get("/", async ({ request }) => {
      const allowed = await readFilterFor(vault, request);
      return index.allTags(allowed);
    })
    .get(
      "/notes",
      async ({ query, request }) => {
        const tag = (query.tag ?? "").trim().replace(/^#/, "");
        if (!tag) return [];
        const allowed = await readFilterFor(vault, request);
        return index.byTag(tag, allowed);
      },
      { query: t.Object({ tag: t.Optional(t.String()) }) },
    );
}
