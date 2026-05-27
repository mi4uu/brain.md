import { Elysia, t } from "elysia";
import type { RagPipeline } from "../rag/pipeline";
import type { SettingsStore } from "../settings/settings";
import { describeProvider } from "../rag/provider";
import { LocalEmbedder } from "../rag/embedder-local";
import {
  OpenAICompatEmbedder,
  EmbedderHttpError,
} from "../rag/embedder-openai";
import type {
  LocalProviderConfig,
  OpenAICompatProviderConfig,
  RagStatus,
} from "../rag/types";

// V47 / V49 / V51: RAG HTTP surface.
// - GET  /api/similar?q=&k=        T105
// - GET  /api/rag/status           T106
// - POST /api/rag/reindex          T107
// - POST /api/rag/test             T108
//
// All routes assume the pipeline has been started by index.ts and that
// settings reflect the chosen provider/model.

export function ragRoutes(pipeline: RagPipeline, settings: SettingsStore) {
  return new Elysia()
    .get(
      "/api/similar",
      async ({ query, set }) => {
        const q = (query.q ?? "").toString();
        const k = Number(query.k ?? 5);
        if (q.trim() === "") {
          set.status = 400;
          return { error: "missing query param: q" };
        }
        if (!Number.isInteger(k) || k < 1 || k > 100) {
          set.status = 400;
          return { error: "k must be an integer in [1, 100]" };
        }
        const cfg = settings.get().rag;
        if (!cfg.enabled) {
          set.status = 503;
          return { error: "RAG disabled in settings", code: "RAG_DISABLED" };
        }
        try {
          const vec = (await pipeline.embed([q]))[0]!;
          const hits = await pipeline.store.search(vec, k);
          return hits;
        } catch (e) {
          set.status = 500;
          return {
            error: e instanceof Error ? e.message : String(e),
            code: e instanceof EmbedderHttpError ? "EMBEDDER_HTTP" : "RAG",
          };
        }
      },
      { query: t.Object({ q: t.Optional(t.String()), k: t.Optional(t.String()) }) },
    )
    .get("/api/rag/status", async (): Promise<RagStatus> => {
      const cfg = settings.get().rag;
      const desc = describeProvider(cfg);
      let chunks = 0;
      let needsReindex = false;
      try {
        chunks = await pipeline.store.countAll();
        if (chunks > 0) {
          const distinct = await pipeline.store.distinctProviderModel();
          needsReindex = distinct.some(
            (d) => d.providerId !== desc.providerId || d.modelId !== desc.modelId,
          );
        }
      } catch {
        // store not opened or empty → leave defaults
      }
      return {
        enabled: cfg.enabled,
        provider: desc.providerId,
        model: desc.modelId,
        dim: desc.dim,
        chunks,
        lastIndexedAt: pipeline.lastIndexedAt,
        needsReindex,
      };
    })
    .post("/api/rag/reindex", async ({ set }) => {
      const cfg = settings.get().rag;
      if (!cfg.enabled) {
        set.status = 503;
        return { error: "RAG disabled in settings", code: "RAG_DISABLED" };
      }
      try {
        const result = await pipeline.reindexAll();
        return { ok: true, ...result };
      } catch (e) {
        set.status = 500;
        return { error: e instanceof Error ? e.message : String(e) };
      }
    })
    .post(
      "/api/rag/test",
      async ({ body, set }) => {
        const provider = body.provider;
        try {
          if (provider === "local") {
            const cfg = body.local as LocalProviderConfig;
            const e = new LocalEmbedder(cfg);
            const [v] = await e.embed(["ping"]);
            return { ok: true, dim: v!.length };
          }
          if (provider === "openai-compat") {
            const cfg = body.openaiCompat as OpenAICompatProviderConfig;
            const e = new OpenAICompatEmbedder(cfg);
            const [v] = await e.embed(["ping"]);
            return { ok: true, dim: v!.length };
          }
          set.status = 400;
          return { error: "unknown provider" };
        } catch (e) {
          set.status = e instanceof EmbedderHttpError ? e.status || 502 : 500;
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      },
      {
        body: t.Object({
          provider: t.Union([t.Literal("local"), t.Literal("openai-compat")]),
          local: t.Optional(
            t.Object({ model: t.String(), dim: t.Number() }),
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
      },
    );
}

