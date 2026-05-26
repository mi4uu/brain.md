import { Elysia, t } from "elysia";
import type { VaultIndex } from "../index/index";
import { search } from "../index/search";

export function searchRoutes(index: VaultIndex) {
  return new Elysia({ prefix: "/api" }).get(
    "/search",
    ({ query }) => search(index, query.q ?? ""),
    { query: t.Object({ q: t.Optional(t.String()) }) },
  );
}
