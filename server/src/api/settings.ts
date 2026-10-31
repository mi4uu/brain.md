import { Elysia, t } from "elysia";
import type { SettingsStore, AppSettings } from "../settings/settings";
import type { Autocommit } from "../git/autocommit";
import type { RagPipeline } from "../rag/pipeline";
import { asError } from "./errors";
import { requireOwner } from "./perm-guard";

// The embedder apiKey is a credential, not UI state: it must never leave
// the server in a GET or PATCH response. Callers get a boolean flag
// instead and change the key by sending a new one (an empty string
// clears it); an omitted field leaves the stored key untouched
// (SettingsStore.mergeRag only overwrites on a string value).
function redact(s: AppSettings): AppSettings & { rag: { openaiCompat: { apiKeySet: boolean } } } {
  const { apiKey, ...rest } = s.rag.openaiCompat;
  return {
    ...s,
    rag: { ...s.rag, openaiCompat: { ...rest, apiKeySet: !!apiKey } },
  } as AppSettings & { rag: { openaiCompat: { apiKeySet: boolean } } };
}

export function settingsRoutes(
  settings: SettingsStore,
  autocommit: Autocommit,
  ragPipeline: RagPipeline,
) {
  return new Elysia({ prefix: "/api/settings" })
    .get("/", ({ request, set }) => {
      try {
        // Server config, not vault content: host allowlist, embedder
        // endpoint, git settings. No per-folder scope applies to it, so
        // it's owner-or-open only, same as the PATCH right below it.
        requireOwner(request);
        return redact(settings.get());
      } catch (e) {
        const { status, body: err } = asError(e);
        set.status = status;
        return err;
      }
    })
    .patch(
      "/",
      async ({ body, set, request }) => {
        try {
          requireOwner(request);
          const prev = settings.get();
          const next = await settings.patch(body);
          // sync to runtime autocommit
          autocommit.setEnabled(next.git.autocommit);
          autocommit.setDebounceMs(next.git.debounceMs);
          // V58: keep the RAG pipeline in sync with config changes.
          // - enabled flipped on → ensureRunning() opens store + subscribes
          // - any rag change → applyConfig() updates embedder if model/provider changed
          ragPipeline.applyConfig(next.rag);
          if (!prev.rag.enabled && next.rag.enabled) {
            // V59: open the store + probe the embedder up-front so the UI
            // can show a real error banner the moment the user flips Enable
            // RAG, instead of waiting for the first reindex to fail.
            try {
              await ragPipeline.ensureRunning();
              await ragPipeline.probe();
            } catch (e) {
              console.warn("[rag] enable failed:", e);
            }
          }
          return redact(next);
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          bookmarks: t.Optional(t.Array(t.String())),
          dailyDir: t.Optional(t.String()),
          git: t.Optional(
            t.Object({
              autocommit: t.Optional(t.Boolean()),
              debounceMs: t.Optional(t.Number()),
            }),
          ),
          // V47/V49/V51: RAG config — without these fields here, Elysia's
          // body validator strips the whole `rag` payload before it reaches
          // settings.patch(), so toggling Enable RAG in the UI did nothing.
          rag: t.Optional(
            t.Object({
              enabled: t.Optional(t.Boolean()),
              provider: t.Optional(
                t.Union([t.Literal("local"), t.Literal("openai-compat")]),
              ),
              local: t.Optional(
                t.Object({
                  model: t.String(),
                  dim: t.Number(),
                }),
              ),
              openaiCompat: t.Optional(
                t.Object({
                  baseURL: t.String(),
                  model: t.String(),
                  apiKey: t.Optional(t.String()),
                  dim: t.Number(),
                }),
              ),
            }),
          ),
        }),
      },
    );
}
