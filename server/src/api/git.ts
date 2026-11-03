import { Elysia, t } from "elysia";
import type { GitRepo } from "../git/git";
import type { Autocommit } from "../git/autocommit";
import type { SettingsStore } from "../settings/settings";
import type { Vault } from "../vault/vault";
import { asError } from "./errors";
import { assertSafePath, assertMarkdown, assertRestoreTargetIsFile } from "../vault/paths";
import { requireRead, requireWrite, requireOwner } from "./perm-guard";
import { principalFor } from "./auth-middleware";
import { isOwnerPrincipal } from "./principal";
import { VaultError } from "../vault/types";

// git matches a directory pathspec recursively, even under
// GIT_LITERAL_PATHSPECS: a per-note permission check on a parent directory
// (or the vault root, path=".") authorises that one synthetic path, but
// log/show/diff then return every file underneath it, including ones the
// same principal is denied individually. Only an owner/open principal (who
// bypasses folder perms anyway) may pass a directory or the whole vault;
// an agent credential must name one existing note, which requireRead then
// checks on its own merits.
async function requireNotePathForAgents(
  vault: Vault,
  request: Request,
  path: string | undefined,
): Promise<void> {
  if (isOwnerPrincipal(principalFor(request))) return;
  if (!path) {
    throw new VaultError("path required for this credential", "FORBIDDEN");
  }
  assertMarkdown(path);
  const st = await vault.stat(path);
  if (!st.exists || st.isDir) {
    throw new VaultError(`note not found: ${path}`, "NOT_FOUND");
  }
}

export function gitRoutes(
  vault: Vault,
  repo: GitRepo,
  autocommit: Autocommit,
  settings: SettingsStore,
) {
  return new Elysia({ prefix: "/api/git" })
    .get("/status", async ({ set, request }) => {
      try {
        // Vault-wide (head, branch, last commit subject) with no folder
        // scoping to filter it through, same reasoning as commit/checkpoint.
        requireOwner(request);
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
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
      async ({ query, set, request }) => {
        try {
          // A path-scoped log is a read of that note's history; gate it
          // the same as reading the note itself. An unscoped (vault-wide)
          // log isn't filtered per-commit here, a known gap for agent
          // credentials, see README/handoff notes.
          if (query.path) await requireRead(vault, request, query.path);
          await requireNotePathForAgents(vault, request, query.path);
          const limit = query.limit ? Math.max(1, Math.min(500, Number(query.limit))) : 50;
          return repo.log({ path: query.path, limit });
        } catch (e) {
          const { status, body } = asError(e);
          set.status = status;
          return body;
        }
      },
      { query: t.Object({ path: t.Optional(t.String()), limit: t.Optional(t.String()) }) },
    )
    .get(
      "/show",
      async ({ query, set, request }) => {
        try {
          await requireRead(vault, request, query.path);
          await requireNotePathForAgents(vault, request, query.path);
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
      async ({ query, set, request }) => {
        try {
          await requireRead(vault, request, query.path);
          await requireNotePathForAgents(vault, request, query.path);
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
      async ({ body, set, request }) => {
        try {
          // Commits the whole working tree with no path scoping at all;
          // an agent credential denied write on every folder could still
          // force a commit otherwise. Owner-or-open only, like /autocommit.
          requireOwner(request);
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
    .post("/flush", async ({ set, request }) => {
      try {
        requireOwner(request);
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
      const sha = await autocommit.flush();
      return { sha };
    })
    .post(
      "/restore",
      async ({ body, set, request }) => {
        try {
          // `git checkout <sha> -- <path>` writes to the real working tree
          // at <path>, unlike show/diff, which only look inside git's
          // tree objects, this one can escape onto the real filesystem if
          // <path> isn't validated the same way every vault write is, and
          // it must not be able to resurrect a historical .brain/ file
          // (auth.json, tokens.json, …) over the live one.
          assertSafePath(body.path);
          assertMarkdown(body.path);
          // Audit P0: a directory literally named "<x>.md" passes the
          // suffix check above; git.ts's own object-type check catches
          // the historical side (a tree committed at that path), this
          // catches the live side (that path currently being a directory
          // on disk), before anything is written.
          await assertRestoreTargetIsFile(vault.root, body.path);
          await requireWrite(vault, request, body.path);
          await repo.restore(body.path, body.sha);
          // `repo.restore` writes straight to the working tree via `git
          // checkout`, bypassing Vault's own write methods, without this,
          // the index and RAG never learn the file changed (V-concurrency
          // #18). Route it through the same notify() everything else uses.
          await vault.notifyWrite(body.path);
          // Audit P0: this used to call commitAll(msg) with no `paths`,
          // staging and committing the ENTIRE working tree (stageAll()),
          // including whatever else was dirty at the time, not just the
          // restored file. Scoping it to the one touched path matches
          // what the commit message claims happened.
          const sha = await repo.commitAll(
            `restore ${body.path} → ${body.sha.slice(0, 7)}`,
            { paths: [body.path] },
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
      async ({ body, set, request }) => {
        try {
          requireOwner(request);
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
      async ({ body, set, request }) => {
        try {
          requireOwner(request);
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
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
