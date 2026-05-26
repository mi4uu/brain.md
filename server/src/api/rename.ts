import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { renameAndPatch } from "../index/rename";
import { asError } from "./errors";

export function renameRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api" }).post(
    "/rename",
    async ({ body, set }) => {
      try {
        const result = await renameAndPatch(vault, index, body.from, body.to);
        return { ok: true, ...result };
      } catch (e) {
        const { status, body: err } = asError(e);
        set.status = status;
        return err;
      }
    },
    { body: t.Object({ from: t.String(), to: t.String() }) },
  );
}
