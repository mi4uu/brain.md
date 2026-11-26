import { Elysia, t } from "elysia";
import { PROPERTY_TYPES } from "@brainmd/shared/property-types";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { listProperties, saveTypeOverride } from "../properties/registry";
import { asError } from "./errors";
import { readFilterFor, requireOwner } from "./perm-guard";

export function propertyRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia()
    .get("/api/properties", async ({ request }) => {
      const allowed = await readFilterFor(vault, request);
      return listProperties(vault, index, allowed);
    })
    .put(
      "/api/properties/types",
      async ({ body, set, request }) => {
        try {
          requireOwner(request);
          if (body.name === "__proto__") {
            set.status = 400;
            return { error: "invalid property name", code: "INVALID_NAME" };
          }
          await saveTypeOverride(vault, body.name, body.type);
          return { ok: true };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 200 }),
          type: t.Union(PROPERTY_TYPES.map((p) => t.Literal(p))),
        }),
      },
    );
}
