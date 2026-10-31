import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import { normalizeRel } from "../vault/paths";
import { asError } from "./errors";
import { loadFolderMeta, saveFolderMeta, withFolderMetaLock } from "./folder-perms";
import { requireWrite, readFilterFor } from "./perm-guard";
import { VaultError } from "../vault/types";

// Icons/colors share folder-meta.json with the MCP folder permissions
// (api/folder-perms.ts). Both go through loadFolderMeta/saveFolderMeta so
// a save here never drops the `mcp` key, and through withFolderMetaLock so
// a concurrent save from either module can't clobber the other's change.

export function metaRoutes(vault: Vault) {
  return new Elysia({ prefix: "/api/folder-meta" })
    .get("/", async ({ request }) => {
      const meta = await loadFolderMeta(vault);
      // Folder paths here are vault content, like tree.ts's own folder
      // listing: a path a principal can't read must not be disclosed
      // just because it has a custom icon or colour.
      const allowed = await readFilterFor(vault, request);
      const visible = (m: Record<string, string>) =>
        Object.fromEntries(Object.entries(m).filter(([path]) => allowed(`${path}/.md`)));
      return { version: meta.version, icons: visible(meta.icons), colors: visible(meta.colors) };
    })
    .post(
      "/",
      async ({ body, set, request }) => {
        try {
          const norm = normalizeRel(body.path);
          await requireWrite(vault, request, `${norm}/.probe`);
          const meta = await withFolderMetaLock(async () => {
            const m = await loadFolderMeta(vault);
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
