import { Elysia, t } from "elysia";
import type { VaultIndex } from "../index/index";

export function resolveRoutes(index: VaultIndex) {
  return new Elysia({ prefix: "/api" })
    .get(
      "/resolve",
      ({ query }) => {
        const name = (query.name ?? "").trim();
        if (!name) return { path: null, matches: [], source: null, ambiguous: false };
        const { matches, source } = index.resolveAny(name);
        return {
          path: matches[0] ?? null,
          matches,
          source,
          ambiguous: matches.length > 1,
        };
      },
      { query: t.Object({ name: t.Optional(t.String()) }) },
    )
    .get("/aliases", () => index.aliasMap());
}
