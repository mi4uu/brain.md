import { Elysia, t } from "elysia";
import type { APIKeyStore } from "../auth/api-keys";
import { asError } from "./errors";
import { requireOwner } from "./perm-guard";

// V66 routes: GET / POST / DELETE on /api/auth/keys.
// Only the owner (V53 session bearer, or the back-compat no-password
// principal) can manage keys, an API key must never be able to mint or
// revoke API keys, including itself a replacement with wider scope.

export function apiKeyRoutes(keys: APIKeyStore) {
  return new Elysia()
    .get("/api/auth/keys", ({ request, set }) => {
      try {
        requireOwner(request);
        return { keys: keys.list() };
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    })
    .post(
      "/api/auth/keys",
      ({ body, request, set }) => {
        try {
          requireOwner(request);
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
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
      ({ params, request, set }) => {
        try {
          requireOwner(request);
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
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
