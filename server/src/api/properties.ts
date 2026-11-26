import { Elysia, t } from "elysia";
import { FrontmatterError } from "@brainmd/shared/frontmatter";
import { PROPERTY_TYPES } from "@brainmd/shared/property-types";
import { NoteConflictError, type Vault } from "../vault/vault";
import { VaultError } from "../vault/types";
import type { VaultIndex } from "../index/index";
import { listProperties, saveTypeOverride } from "../properties/registry";
import { updateProperties } from "../properties/update";
import { asError } from "./errors";
import { decodeWildcard } from "./wildcard";
import { readFilterFor, requireOwner, requireRead, requireWrite } from "./perm-guard";

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
          if (body.name === "__proto__") throw new VaultError("invalid property name", "INVALID_VALUE");
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
    )
    .patch(
      "/api/note-properties/*",
      async ({ params, body, set, request }) => {
        const rel = decodeWildcard((params as { "*": string })["*"]);
        try {
          await requireWrite(vault, request, rel);
          const canRead = (await readFilterFor(vault, request))(rel);
          // A revision is only meaningful to someone who can read the note,
          // and the conflict reply carries the current one.
          if (body.baseRevision !== undefined) await requireRead(vault, request, rel);
          const r = await updateProperties(
            vault,
            rel,
            { set: body.set, unset: body.unset, baseRevision: body.baseRevision },
            canRead,
          );
          return { path: r.path, mtime: r.mtime, ...(canRead ? { revision: r.revision } : {}) };
        } catch (e) {
          if (e instanceof NoteConflictError) {
            set.status = 409;
            return { code: "CONFLICT", revision: e.currentRevision };
          }
          if (e instanceof FrontmatterError) {
            set.status = 422;
            return { code: e.code, error: e.message };
          }
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          set: t.Optional(t.Record(t.String(), t.Any())),
          unset: t.Optional(t.Array(t.String())),
          baseRevision: t.Optional(t.String()),
        }),
      },
    );
}
