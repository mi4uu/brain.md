import { Elysia } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { decodeWildcard } from "./wildcard";
import { requireRead, readFilterFor } from "./perm-guard";
import { asError } from "./errors";

export function backlinkRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api/backlinks" }).get("/*", async ({ params, request, set }) => {
    const rel = decodeWildcard((params as { "*": string })["*"]);
    try {
      await requireRead(vault, request, rel);
      const allowed = await readFilterFor(vault, request);
      return index.backlinks(rel, allowed);
    } catch (e) {
      const { status, body } = asError(e);
      set.status = status;
      return body;
    }
  });
}
