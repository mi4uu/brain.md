import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import type { VaultIndex } from "../index/index";
import { readFilterFor } from "./perm-guard";

export function resolveRoutes(vault: Vault, index: VaultIndex) {
  return new Elysia({ prefix: "/api" })
    .get(
      "/resolve",
      async ({ query, request }) => {
        const name = (query.name ?? "").trim();
        if (!name) return { path: null, matches: [], source: null, ambiguous: false };
        const { matches, source } = index.resolveAny(name);
        const allowed = await readFilterFor(vault, request);
        const filtered = matches.filter(allowed);
        return {
          path: filtered[0] ?? null,
          matches: filtered,
          source: filtered.length > 0 ? source : null,
          ambiguous: filtered.length > 1,
        };
      },
      { query: t.Object({ name: t.Optional(t.String()) }) },
    )
    .get("/aliases", async ({ request }) => {
      const allowed = await readFilterFor(vault, request);
      const out: Record<string, string[]> = {};
      for (const [alias, paths] of Object.entries(index.aliasMap())) {
        const visible = paths.filter(allowed);
        if (visible.length > 0) out[alias] = visible;
      }
      return out;
    });
}
