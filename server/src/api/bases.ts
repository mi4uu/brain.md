import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { runBaseQuery, queryIndexFor } from "../bases/query";
import { listProperties } from "../properties/registry";
import type { Visibility } from "../vault/visibility";
import { readFilterFor } from "./perm-guard";

export function baseRoutes(vault: Vault, index: VaultIndex, visibility: Visibility) {
  return new Elysia({ prefix: "/api/bases" }).post(
    "/query",
    async ({ body, request }) => {
      const allowed = await readFilterFor(vault, request);
      const types = new Map((await listProperties(vault, index, allowed)).map((p) => [p.name, p.type] as const));
      return runBaseQuery(body, { index: queryIndexFor(index, visibility), allowed, types });
    },
    {
      body: t.Object({
        source: t.String({ maxLength: 100_000 }),
        view: t.Optional(t.String({ maxLength: 200 })),
        thisPath: t.Optional(t.String({ maxLength: 1000 })),
        offset: t.Optional(t.Integer({ minimum: 0 })),
        limit: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  );
}
