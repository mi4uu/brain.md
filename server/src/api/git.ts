import { Elysia, t } from "elysia";
import { RevertError, type GitRepo } from "../git/git";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Autocommit } from "../git/autocommit";
import { singleActorCommitOpts } from "../git/autocommit";
import { currentIdentity } from "../auth/identity";
import type { SettingsStore } from "../settings/settings";
import type { Vault } from "../vault/vault";
import { asError } from "./errors";
import { assertSafePath, assertMarkdown, assertRestoreTargetIsFile, assertRealContainment } from "../vault/paths";
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

// The owner's "seen up to here" cursor for the Changes view. One cursor per
// vault, not per login: every login (password, Google, GitHub) is the same
// single owner, and phone and desktop must agree on what is new. Lives under
// .brain/, which the vault's .gitignore keeps out of history.
interface SeenCursor {
  sha: string;
  ts: number;
}

const REVERT_STATUS: Record<RevertError["code"], number> = {
  NOT_FOUND: 404,
  NOT_CHANGED: 400,
  UNSUPPORTED: 400,
  CREATED: 400,
  PENDING: 409,
  CONFLICT: 409,
};

// Mark-seen is read, compare, write; run one at a time so two quick
// requests cannot leave the older one on disk.
let seenChain: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  const next = seenChain.then(fn, fn);
  seenChain = next.catch(() => undefined);
  return next;
}

function seenFile(vault: Vault): string {
  return join(vault.root, ".brain", "changes-seen.json");
}

async function readSeen(vault: Vault): Promise<SeenCursor | null> {
  try {
    const raw = JSON.parse(await readFile(seenFile(vault), "utf8")) as Partial<SeenCursor>;
    if (typeof raw.sha === "string" && /^[a-f0-9]{4,64}$/i.test(raw.sha) && typeof raw.ts === "number") {
      return { sha: raw.sha, ts: raw.ts };
    }
  } catch {
    // missing or unreadable: nothing seen yet
  }
  return null;
}

export function gitRoutes(
  vault: Vault,
  repo: GitRepo,
  autocommit: Autocommit,
  settings: SettingsStore,
  isHidden: (path: string) => boolean = () => false,
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
          //
          // Attribution: /restore is reachable by any credential with
          // write access (requireWrite above), not just the owner, unlike
          // /commit and /checkpoint, which requireOwner. Without this,
          // every restore lands as the default committer identity
          // (brain.md/brain@local) no matter who actually ran it.
          const identity = currentIdentity();
          const sha = await repo.commitAll(
            `restore ${body.path} → ${body.sha.slice(0, 7)}`,
            { paths: [body.path], ...(identity ? singleActorCommitOpts(identity) : {}) },
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
    .get(
      "/changes",
      async ({ query, set, request }) => {
        try {
          // Lists paths across the whole vault, so it cannot be scoped by
          // folder permissions: owner only, like the other vault-wide routes.
          requireOwner(request);
          if (!(await repo.isEnabled())) return { enabled: false, seen: null, commits: [], hasMore: false };
          const asked = Number(query.limit);
          const limit = Number.isFinite(asked) && asked > 0 ? Math.min(500, Math.floor(asked)) : 200;
          const commits = await repo.changes({ limit: limit + 1, before: query.before });
          // Agents' working files are often hidden notes; the UI leaves them
          // out unless "show hidden" is on, so it needs to know which.
          for (const c of commits) for (const f of c.files) if (isHidden(f.path)) f.hidden = true;
          return {
            enabled: true,
            seen: await readSeen(vault),
            commits: commits.slice(0, limit),
            hasMore: commits.length > limit,
          };
        } catch (e) {
          const { status, body } = asError(e);
          set.status = status;
          return body;
        }
      },
      { query: t.Object({ limit: t.Optional(t.String()), before: t.Optional(t.String()) }) },
    )
    .post(
      "/changes/seen",
      async ({ body, set, request }) => {
        try {
          // Agents never move the owner's cursor; only the owner marks seen.
          requireOwner(request);
          if (!/^[a-f0-9]{4,64}$/i.test(body.sha)) throw new VaultError("invalid sha", "INVALID_PATH");
          // Time and identity come from git, not the client, and the cursor
          // only ever moves forward along history.
          const next = await repo.commitTime(body.sha);
          if (!next || !(await repo.isAncestor(next.sha, "HEAD").catch(() => false))) {
            throw new VaultError(`no commit ${body.sha} in this vault's history`, "NOT_FOUND");
          }
          return await oneAtATime(async () => {
            const prev = await readSeen(vault);
            if (prev && prev.sha !== next.sha && (await repo.isAncestor(next.sha, prev.sha).catch(() => false))) {
              return prev;
            }
            await mkdir(join(vault.root, ".brain"), { recursive: true });
            const tmp = `${seenFile(vault)}.${process.pid}.${Date.now()}.tmp`;
            try {
              await writeFile(tmp, JSON.stringify(next));
              await rename(tmp, seenFile(vault));
            } catch (e) {
              await rm(tmp, { force: true });
              throw e;
            }
            return next;
          });
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      { body: t.Object({ sha: t.String(), ts: t.Optional(t.Number()) }) },
    )
    .get(
      "/patch",
      async ({ query, set, request }) => {
        try {
          await requireRead(vault, request, query.path);
          await requireNotePathForAgents(vault, request, query.path);
          if (query.oldPath) await requireRead(vault, request, query.oldPath);
          const patch = await repo.commitPatch(query.sha, query.path, query.oldPath);
          return { patch };
        } catch (e) {
          const { status, body } = asError(e);
          set.status = status;
          return body;
        }
      },
      { query: t.Object({ sha: t.String(), path: t.String(), oldPath: t.Optional(t.String()) }) },
    )
    .post(
      "/revert",
      async ({ body, set, request }) => {
        try {
          requireOwner(request);
          assertSafePath(body.path);
          assertMarkdown(body.path);
          await assertRestoreTargetIsFile(vault.root, body.path);
          await assertRealContainment(vault.root, join(vault.root, body.path));
          await requireWrite(vault, request, body.path);
          // Gives edits still waiting for the debounce a chance to land as
          // their own commit; revertChange refuses if the note is still dirty.
          await autocommit.flush();
          const identity = currentIdentity();
          const commitOpts = identity ? singleActorCommitOpts(identity) : {};
          if (body.mode === "trash") {
            // The change created the note: undoing it moves the note to
            // Trash, through the vault like any delete, then records it.
            await repo.assertCreatedHere(body.sha, body.path);
            await vault.deleteNote(body.path);
            const sha = await repo.commitAll(`revert ${body.path} (trash, created in ${body.sha.slice(0, 7)})`, {
              paths: [body.path],
              ...commitOpts,
            });
            return { ok: true, sha };
          }
          const sha = await repo.revertChange({
            sha: body.sha,
            path: body.path,
            mode: body.mode,
            message: `revert ${body.path} (${body.mode === "restore" ? "restore before" : "undo"} ${body.sha.slice(0, 7)})`,
            ...commitOpts,
          });
          await vault.notifyWrite(body.path);
          return { ok: true, sha };
        } catch (e) {
          if (e instanceof RevertError) {
            set.status = REVERT_STATUS[e.code];
            const message =
              e.code === "PENDING" && !autocommit.opts.enabled
                ? `${e.message}. Autocommit is off, so commit them first (More, Commit now)`
                : e.code === "PENDING"
                  ? `${e.message}, try again in a few seconds`
                  : e.message;
            return { error: message, code: e.code };
          }
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          sha: t.String(),
          path: t.String(),
          mode: t.Union([t.Literal("patch"), t.Literal("restore"), t.Literal("trash")]),
        }),
      },
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
