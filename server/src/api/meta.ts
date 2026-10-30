import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import { normalizeRel } from "../vault/paths";
import { asError } from "./errors";
import { loadFolderMeta, saveFolderMeta, withFolderMetaLock } from "./folder-perms";
import { VaultError } from "../vault/types";

// Icons/colors share folder-meta.json with the MCP folder permissions
// (api/folder-perms.ts). Both go through loadFolderMeta/saveFolderMeta so
// a save here never drops the `mcp` key, and through withFolderMetaLock so
// a concurrent save from either module can't clobber the other's change.

export function metaRoutes(vault: Vault) {
  return new Elysia({ prefix: "/api/folder-meta" })
    .get("/", async () => {
      const meta = await loadFolderMeta(vault);
      return { version: meta.version, icons: meta.icons, colors: meta.colors };
    })
    .post(
      "/",
      async ({ body, set }) => {
        try {
          const meta = await withFolderMetaLock(async () => {
            const m = await loadFolderMeta(vault);
            const norm = normalizeRel(body.path);
            if (norm === "") {
              throw new VaultError("root folder cannot be customised", "INVALID_PATH");
            }
            if (body.icon === null || body.icon === undefined) {
              delete m.icons[norm];
            } else {
              m.icons[norm] = body.icon;
            }
            if (body.color === null) {
              delete m.colors[norm];
            } else if (body.color !== undefined) {
              m.colors[norm] = body.color;
            }
            await saveFolderMeta(vault, m);
            return m;
          });
          return {
            ok: true,
            meta: { version: meta.version, icons: meta.icons, colors: meta.colors },
          };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          path: t.String(),
          icon: t.Optional(t.Union([t.String(), t.Null()])),
          color: t.Optional(t.Union([t.String(), t.Null()])),
        }),
      },
    );
}
