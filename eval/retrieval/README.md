# Retrieval eval

Harness used to pick the embedding model, fusion and reranker for brain.md search. It scores note-level rankings with recall@10, MRR@10 and nDCG@10, split by query type.

The numbers in the 2026-11 eval came from a private golden set (52 queries, real and written, over a real vault). That set is not in the repo. `fixtures/example-golden.jsonl` holds 16 queries over `example/vault` in the same format, so the harness runs end to end on a clean checkout.

## Data

Run everything from a work directory that holds:

- `chunks.jsonl`: one chunk per line, `{"path", "idx", "text"}`, made by brain.md's own chunker:
  `bun eval/retrieval/export-chunks.ts <vault> chunks.jsonl`
- `golden.jsonl`: one query per line, `{"id", "q", "type", "rel": ["<note path>", ...]}`; labels are binary
- `results/`: output, one JSON file per system
- `cache/`: document embeddings, keyed by model, chunk set and document prefix (created on demand)

Chunks under `secrets/` and `.brain/` are dropped on load. A passage is the note title plus the chunk text.

## Scripts

| Script | Produces |
|---|---|
| `make_hybrid.py` | `bm25.json`, plus an RRF hybrid of BM25 with every dense result already in `results/` |
| `run_dense.py <name>` | `dense-<name>.json`; models and prefixes in `CFG`, revisions in `pinned.json`; doc embeddings cached in `cache/` |
| `run_bgem3_sparse.py` | bge-m3 dense, sparse, and dense plus weighted sparse |
| `run_rerank.py <name> <base>` | cross-encoder rerank of the top 20 of `<base>` |
| `run_llm_rerank.py <model> <base>` | LLM rerank by P(yes) over an OpenAI-compatible server (`LLM_URL`, `LLM_KEY`) |
| `run_gguf.py <name> <gguf> <query prefix> <doc prefix>` | a GGUF embedder through llama-server `/v1/embeddings`: index on GPU, then query latency, RSS and chunks/s on one pinned CPU thread (`LLAMA_SERVER`, `CPU_CORE`) |
| `bench_cpu.py <name> <gguf> <query prefix> <doc prefix>` | CPU-only llama-server bench: query p50/p95, RSS, full reindex time, one median and the largest note (`LLAMA_SERVER`, `THREADS`) |
| `fusion.py` | weighted RRF and score blends of BM25 with dense results |
| `collect_brainmd.py` | rankings from a running brain.md (`search_notes`, `similar_notes`) at `BRAINMD_URL` (default `http://localhost:3000`) |
| `paired.py` | paired bootstrap CI of nDCG@10 differences for the pairs listed in it, on all queries and on `real` ones |
| `analyze.py [ref] [filter]` | the table: metrics, per-type nDCG, paired wins/losses against `ref`, latency |

`run_gguf.py` and `bench_cpu.py` are Linux only (`taskset`, `/proc`). `fusion.py` and `paired.py` compare the systems named in them and skip what is missing from `results/`.

Env: `DEVICE` (`cpu` or `cuda`), `THROUGHPUT=1` to time indexing, `LIMIT=n` to time reranking on the first n queries only.

## Quick run on the example vault

```sh
mkdir -p /tmp/rag-eval/results && cd /tmp/rag-eval
bun <repo>/eval/retrieval/export-chunks.ts <repo>/example/vault chunks.jsonl
cp <repo>/eval/retrieval/fixtures/example-golden.jsonl golden.jsonl
python3 <repo>/eval/retrieval/make_hybrid.py
python3 <repo>/eval/retrieval/analyze.py bm25
```

Dense and rerank scripts need `sentence-transformers` and `torch`; `run_bgem3_sparse.py` also needs `FlagEmbedding`. Sixteen queries over a tiny vault only show that the harness works. Do not tune on them.
