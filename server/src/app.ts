import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { config } from "./config";
import { Vault } from "./vault/vault";
import { VaultIndex } from "./index/index";
import { GitRepo } from "./git/git";
import { Autocommit } from "./git/autocommit";
import { SettingsStore } from "./settings/settings";
import { treeRoutes } from "./api/tree";
import { noteRoutes } from "./api/notes";
import { folderRoutes } from "./api/folders";
import { mediaRoutes } from "./api/media";
import { searchRoutes } from "./api/search";
import { resolveRoutes } from "./api/resolve";
import { backlinkRoutes } from "./api/backlinks";
import { renameRoutes } from "./api/rename";
import { trashRoutes } from "./api/trash";
import { tasksRoutes } from "./api/tasks";
import { tagRoutes } from "./api/tags";
import { gitRoutes } from "./api/git";
import { metaRoutes } from "./api/meta";
import { settingsRoutes } from "./api/settings";

export interface AppOptions {
  vaultDir?: string;
  gitAutocommit?: boolean;
  gitDebounceMs?: number;
}

export function createApp(opts: AppOptions = {}) {
  const vault = new Vault(opts.vaultDir ?? config.vaultDir);
  const index = new VaultIndex(vault);
  const repo = new GitRepo(vault.root);
  const settings = new SettingsStore(vault);
  const autocommit = new Autocommit(repo, {
    enabled: opts.gitAutocommit ?? config.gitAutocommit,
    debounceMs: opts.gitDebounceMs ?? config.gitDebounceMs,
  });
  vault.onMutation((e) => autocommit.notify(e.path));

  const app = new Elysia()
    .use(cors())
    .get("/health", () => ({ ok: true, vaultDir: vault.root }))
    .use(treeRoutes(vault))
    .use(noteRoutes(vault, index))
    .use(folderRoutes(vault))
    .use(mediaRoutes(vault))
    .use(searchRoutes(index))
    .use(resolveRoutes(index))
    .use(backlinkRoutes(index))
    .use(renameRoutes(vault, index))
    .use(trashRoutes(vault, index))
    .use(tasksRoutes(index))
    .use(tagRoutes(index))
    .use(gitRoutes(repo, autocommit, settings))
    .use(metaRoutes(vault))
    .use(settingsRoutes(settings, autocommit));
  return { app, vault, index, repo, autocommit, settings };
}

export type AppHandle = ReturnType<typeof createApp>;
