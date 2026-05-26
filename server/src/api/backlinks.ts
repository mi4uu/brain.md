import { Elysia } from "elysia";
import type { VaultIndex } from "../index/index";
import { decodeWildcard } from "./wildcard";

export function backlinkRoutes(index: VaultIndex) {
  return new Elysia({ prefix: "/api/backlinks" }).get("/*", ({ params }) => {
    const rel = decodeWildcard((params as { "*": string })["*"]);
    return index.backlinks(rel);
  });
}
