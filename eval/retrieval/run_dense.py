"""Embed chunks and queries with one model on CPU; write note rankings + timings."""
import json, os, statistics, sys, time
import numpy as np, torch
from sentence_transformers import SentenceTransformer
import evalcore as e

torch.set_num_threads(4)
DEVICE = os.environ.get("DEVICE", "cpu")
TAG = "" if DEVICE == "cpu" else f"-{DEVICE}"
PIN = json.load(open(os.path.join(os.path.dirname(__file__), "pinned.json")))
F2 = "Instruct: Given a question, retrieve passages that can help answer the question.\nQuery: "
CFG = {
    "bge-small": ("BAAI/bge-small-en-v1.5", "Represent this sentence for searching relevant passages: ", ""),
    "qwen3-emb-0.6b": ("Qwen/Qwen3-Embedding-0.6B", "@query", ""),
    "bge-m3": ("BAAI/bge-m3", "", ""),
    "me5-small": ("intfloat/multilingual-e5-small", "query: ", "passage: "),
    "me5-base": ("intfloat/multilingual-e5-base", "query: ", "passage: "),
    "mmlw-base": ("sdadas/mmlw-retrieval-roberta-base", "zapytanie: ", ""),
    "mmlw-large": ("sdadas/mmlw-retrieval-roberta-large", "zapytanie: ", ""),
    "f2llm-v2-0.6b": ("codefuse-ai/F2LLM-v2-0.6B", F2, ""),
    "f2llm-v2-160m": ("codefuse-ai/F2LLM-v2-160M", F2, ""),
    "embeddinggemma-300m": ("google/embeddinggemma-300m", "@query", "@document"),
}

name = sys.argv[1]
repo, qp, dp = CFG[name]
t0 = time.time()
model = SentenceTransformer(repo, revision=PIN.get(repo), device=DEVICE, trust_remote_code=False)
model.max_seq_length = 512
load_s = time.time() - t0

chunks = e.load_chunks()
golden = e.load_golden()

def enc(texts, prefix, batch=8):
    if prefix.startswith("@"):
        kw = {"prompt_name": prefix[1:]}
    else:
        kw = {"prompt": prefix} if prefix else {}
    return model.encode(texts, batch_size=batch, normalize_embeddings=True, convert_to_numpy=True, **kw)

os.makedirs("cache", exist_ok=True)
key = e.chunks_key(chunks, dp, "%s@%s" % (repo, PIN.get(repo)))
cache = f"cache/{name}-{key}.npy"
t0 = time.time()
try:
    D = np.load(cache)
    index_s = None
except FileNotFoundError:
    D = enc([c["passage"] for c in chunks], dp)
    e.save_npy(cache, D)
    index_s = time.time() - t0

throughput = None
if os.environ.get("THROUGHPUT"):
    sample = [c["passage"] for c in chunks[:40]]
    t = time.time()
    enc(sample, dp)
    throughput = round(len(sample) / (time.time() - t), 2)

enc(["warm up"], qp, batch=1)
rankings, lat = {}, []
for q in golden:
    t = time.perf_counter()
    qv = enc([q["q"]], qp, batch=1)[0]
    lat.append((time.perf_counter() - t) * 1000)
    scores = D @ qv
    rankings[q["id"]] = e.doc_ranking(chunks, scores.tolist())
e.write_json(f"results/dense-{name}{TAG}.json", {
    "name": name + TAG, "repo": repo, "revision": PIN.get(repo), "query_prefix": qp, "doc_prefix": dp,
    "load_s": round(load_s, 1), "index_s": None if index_s is None else round(index_s, 1),
    "query_ms_p50": round(statistics.median(lat), 1), "query_ms_p95": round(e.p95(lat), 1),
    "rss_peak_mb": e.peak_rss_mb(),
    "rankings": rankings,
    "device": DEVICE, "chunks_per_s": throughput, "threads": torch.get_num_threads(),
})
print(name, "done", round(load_s, 1), index_s and round(index_s, 1))
