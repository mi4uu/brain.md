---
title: RAG (Semantic Search)
aliases: [Semantic Search, Embeddings, Vector Search]
tags: [ai, rag, demo]
---

# RAG — local-first semantic search

When a note is saved, brain.md chunks it (≤512 tokens, ~64-token
overlap, paragraph-aligned), embeds each chunk and upserts the
vectors into a per-vault **LanceDB** table at
`<VAULT>/.brain/lance/`.

> [!tip] No API key required
> The default embedder is `bge-small-en-v1.5` (384-dim) running
> locally via Xenova ONNX. First call downloads ~133MB once; after
> that it's pure CPU inference, fully offline.

## Switch to any OpenAI-compatible endpoint

Settings → **AI / RAG** → Provider → `openai-compat` lets you point at:

- **Ollama** — `http://localhost:11434/v1` + `nomic-embed-text`
- **LM Studio** — `http://localhost:1234/v1` + any GGUF embedding
- **OpenAI** — `https://api.openai.com/v1` + `text-embedding-3-small`
- Anything else that mirrors `POST /v1/embeddings` with the
  `{input, model}` shape.

Hit **Test connection** before saving; brain.md probes the endpoint
and reports back the actual embedding dimension.

## Endpoints

| Method | Path                  | What                                          |
|--------|-----------------------|-----------------------------------------------|
| GET    | `/api/similar?q=…&k=` | Top-k semantic hits with snippet + line range |
| GET    | `/api/rag/status`     | Provider, model, chunk count, needsReindex    |
| POST   | `/api/rag/reindex`    | Walks the vault and rebuilds the index        |
| POST   | `/api/rag/test`       | Dry-run an embedder config without saving     |

## Resilience

- Pipeline never crashes vault writes — RAG failures are logged and
  swallowed.
- Switch the model? `model_id` mismatch in the store flips
  `needsReindex: true` in `/api/rag/status`.
- The whole `lance/` directory is git-ignored so the vault repo stays
  text-only.
