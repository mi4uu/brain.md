import { Elysia, t } from "elysia";
import type { GitRepo } from "../git/git";
import type { Autocommit } from "../git/autocommit";
import type { SettingsStore } from "../settings/settings";
import { asError } from "./errors";

export function gitRoutes(repo: GitRepo, autocommit: Autocommit, settings: SettingsStore) {
  return new Elysia({ prefix: "/api/git" })
    .get("/status", async () => {
      const status = await repo.status();
      return {
        ...status,
        autocommit: {
          enabled: autocommit.opts.enabled,
          debounceMs: autocommit.opts.debounceMs,
        },
      };
    })
    .get(
      "/log",
      async ({ query }) => {
        const limit = query.limit ? Math.max(1, Math.min(500, Number(query.limit))) : 50;
        return repo.log({ path: query.path, limit });
      },
      { query: t.Object({ path: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
    )
    .get(
      "/show",
      async ({ query, set }) => {
        try {
          const content = await repo.show(query.sha, query.path);
          return { content };
        } catch (e) {
          const { status, body } = asError(e);
          set.status = status;
          return body;
        }
      },
      { query: t.Object({ sha: t.String(), path: t.String() }) },
    )
    .get(
      "/diff",
      async ({ query, set }) => {
        try {
          const patch = await repo.diff(query.sha, query.path);
          return { patch };
        } catch (e) {
          const { status, body } = asError(e);
          set.status = status;
          return body;
        }
      },
      { query: t.Object({ sha: t.String(), path: t.String() }) },
    )
    .post(
      "/commit",
      async ({ body, set }) => {
        try {
          const msg = body.message?.trim() || "manual";
          const sha = await repo.commitAll(msg);
          return { sha };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      { body: t.Object({ message: t.Optional(t.String()) }) },
    )
    .post("/flush", async () => {
      const sha = await autocommit.flush();
      return { sha };
    })
    .post(
      "/restore",
      async ({ body, set }) => {
        try {
          await repo.restore(body.path, body.sha);
          const sha = await repo.commitAll(
            `restore ${body.path} → ${body.sha.slice(0, 7)}`,
          );
          return { ok: true, sha };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      { body: t.Object({ path: t.String(), sha: t.String() }) },
    )
    .post(
      "/checkpoint",
      async ({ body, set }) => {
        try {
          const msg = body.message?.trim() || "checkpoint";
          const sha = await repo.commitAll(msg);
          const tagName = `cp-${Date.now()}`;
          if (sha) await repo.tag(tagName, msg);
          return { sha, tag: tagName };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      { body: t.Object({ message: t.Optional(t.String()) }) },
    )
    .post(
      "/autocommit",
      async ({ body }) => {
        if (body.enabled !== undefined) autocommit.setEnabled(body.enabled);
        if (body.debounceMs !== undefined) autocommit.setDebounceMs(body.debounceMs);
        await settings.patch({
          git: {
            autocommit: autocommit.opts.enabled,
            debounceMs: autocommit.opts.debounceMs,
          },
        });
        return {
          enabled: autocommit.opts.enabled,
          debounceMs: autocommit.opts.debounceMs,
        };
      },
      {
        body: t.Object({
          enabled: t.Optional(t.Boolean()),
          debounceMs: t.Optional(t.Number()),
        }),
      },
    );
}
