import { Elysia, t } from "elysia";
import type { VaultIndex } from "../index/index";

export function tagRoutes(index: VaultIndex) {
  return new Elysia({ prefix: "/api/tags" })
    .get("/", () => index.allTags())
    .get(
      "/notes",
      ({ query }) => {
        const tag = (query.tag ?? "").trim().replace(/^#/, "");
        if (!tag) return [];
        return index.byTag(tag);
      },
      { query: t.Object({ tag: t.Optional(t.String()) }) },
    );
}
