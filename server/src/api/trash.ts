import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { asError } from "./errors";

export function trashRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api" })
    .get("/trash", async () => vault.listTrash())
    .post(
      "/trash/restore",
      async ({ body, set }) => {
        try {
          const original = await vault.restoreFromTrash(body.trashPath);
          if (original.endsWith(".md")) {
            await index.updatePath(original);
          }
          return { ok: true, path: original };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      { body: t.Object({ trashPath: t.String() }) },
    );
}
