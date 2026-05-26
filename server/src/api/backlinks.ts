import { Elysia } from "elysia";
import type { VaultIndex } from "../index/index";

export function backlinkRoutes(index: VaultIndex) {
  return new Elysia({ prefix: "/api/backlinks" }).get("/*", ({ params }) => {
    const rel = (params as { "*": string })["*"];
    return index.backlinks(rel);
  });
}
