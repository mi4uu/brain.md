import { Elysia } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { buildGraph } from "../index/graph";
import { readFilterFor } from "./perm-guard";

export function graphRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia().get("/api/graph", async ({ request }) => buildGraph(index, await readFilterFor(vault, request)));
}
