import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { join } from "node:path";
import { config } from "./config";
import { Vault } from "./vault/vault";
import { VaultIndex } from "./index/index";
import { GitRepo } from "./git/git";
import { Autocommit } from "./git/autocommit";
import { SettingsStore } from "./settings/settings";
import { RagStore } from "./rag/store";
import { RagPipeline } from "./rag/pipeline";
import { DEFAULT_RAG_CONFIG } from "./rag/types";
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
import { ragRoutes } from "./api/rag";
import { authRoutes } from "./api/auth";
import { authMiddleware } from "./api/auth-middleware";
import { oauthDiscoveryRoutes } from "./api/oauth-discovery";
import { oauthFlowRoutes } from "./api/oauth-flow";
import { OAuthStore } from "./auth/oauth-store";
import { OAuthClientStore } from "./auth/oauth-clients";
import { CimdResolver } from "./auth/cimd";
import { APIKeyStore } from "./auth/api-keys";
import { apiKeyRoutes } from "./api/api-keys";
import { folderPermsRoutes } from "./api/folder-perms";
import { AuthStore } from "./auth/store";
import { TokenStore } from "./auth/tokens";
import { createMcp, mcpRoutes } from "./mcp/server";

export interface AppOptions {
  vaultDir?: string;
  gitAutocommit?: boolean;
  gitDebounceMs?: number;
  mcpDisabled?: boolean;
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

  // RAG pipeline — store dim is taken from the currently selected provider's
  // dim. SettingsStore.load() will overwrite this cfg with the persisted one;
  // index.ts is responsible for calling pipeline.applyConfig(persistedCfg)
  // and triggering the initial reindex after settings.load() returns.
  const initialRagCfg = DEFAULT_RAG_CONFIG;
  const ragDim =
    initialRagCfg.provider === "local"
      ? initialRagCfg.local.dim
      : initialRagCfg.openaiCompat.dim;
  const ragStore = new RagStore(join(vault.root, ".brain", "lance"), ragDim);
  const ragPipeline = new RagPipeline(vault, ragStore, initialRagCfg);

  const authStore = new AuthStore(vault);
  const tokenStore = new TokenStore();
  const oauthStore = new OAuthStore();
  oauthStore.startSweeper();
  const oauthClients = new OAuthClientStore();
  const cimdResolver = new CimdResolver();
  const apiKeys = new APIKeyStore();

  const app = new Elysia()
    .use(cors())
    .use(authMiddleware(authStore, tokenStore, oauthStore, apiKeys))
    .get("/health", () => ({ ok: true, vaultDir: vault.root }))
    // V64: OAuth discovery surface, served before everything else so it's
    // reachable even when auth.json gates the rest of the API.
    .use(oauthDiscoveryRoutes())
    // V63 step 2+3 + V67: authorize + token + register endpoints
    // (PKCE + DCR + CIMD).
    .use(oauthFlowRoutes(authStore, oauthStore, oauthClients, cimdResolver))
    .use(authRoutes(authStore, tokenStore))
    .use(apiKeyRoutes(apiKeys))
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
    .use(settingsRoutes(settings, autocommit, ragPipeline))
    .use(ragRoutes(ragPipeline, settings, vault, index))
    .use(folderPermsRoutes(vault));

  // T120: mount MCP unless disabled via CLI flag
  let mcp: ReturnType<typeof createMcp> | undefined;
  if (!opts.mcpDisabled) {
    mcp = createMcp({
      vault,
      index,
      pipeline: ragPipeline,
      ragEnabled: () => settings.get().rag.enabled,
    });
    app.use(mcpRoutes(mcp));
  }
  return {
    app,
    vault,
    index,
    repo,
    autocommit,
    settings,
    ragStore,
    ragPipeline,
    authStore,
    tokenStore,
    apiKeys,
    mcp,
  };
}

export type AppHandle = ReturnType<typeof createApp>;
