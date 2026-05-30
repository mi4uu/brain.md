import { Elysia, t } from "elysia";
import type { APIKeyStore } from "../auth/api-keys";

// V66 routes: GET / POST / DELETE on /api/auth/keys.
// Sit behind the same auth-middleware as the rest of /api/* — only
// the V53 session bearer (i.e. the logged-in web UI) can manage keys.

export function apiKeyRoutes(keys: APIKeyStore) {
  return new Elysia()
    .get("/api/auth/keys", () => ({ keys: keys.list() }))
    .post(
      "/api/auth/keys",
      ({ body }) => {
        const created = keys.create({
          name: body.name,
          expiresInDays: body.expiresInDays ?? null,
        });
        // Return the full token EXACTLY ONCE. After this round trip
        // the UI must surface it to the user; we never expose the raw
        // token in subsequent GETs.
        return {
          id: created.id,
          name: created.name,
          token: created.token,
          createdAt: created.createdAt,
          expiresAt: created.expiresAt,
        };
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1, maxLength: 200 }),
          expiresInDays: t.Optional(t.Union([t.Number(), t.Null()])),
        }),
      },
    )
    .delete(
      "/api/auth/keys/:id",
      ({ params, set }) => {
        const ok = keys.revoke(params.id);
        if (!ok) {
          set.status = 404;
          return { error: "not found", code: "API_KEY_NOT_FOUND" };
        }
        return { ok: true };
      },
      { params: t.Object({ id: t.String() }) },
    );
}
