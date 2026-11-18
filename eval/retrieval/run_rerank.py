"""Rerank the top 20 notes of a base ranking with one cross-encoder on CPU."""
import json, os, statistics, sys, time
import torch
from sentence_transformers import CrossEncoder
import evalcore as e

torch.set_num_threads(4)
DEVICE = os.environ.get("DEVICE", "cpu")
LIMIT = int(os.environ.get("LIMIT", "0"))
PIN = json.load(open(os.path.join(os.path.dirname(__file__), "pinned.json")))
CFG = {
    "qwen3-reranker-0.6b": ("Qwen/Qwen3-Reranker-0.6B", False),
    "bge-reranker-v2-m3": ("BAAI/bge-reranker-v2-m3", False),
    "polish-reranker-v2": ("sdadas/polish-reranker-roberta-v2", False),
    "gte-ml-reranker": ("Alibaba-NLP/gte-multilingual-reranker-base", True),
    "mxbai-rerank-base-v2": ("mixedbread-ai/mxbai-rerank-base-v2", False),
    "zerank-1-small": ("zeroentropy/zerank-1-small", True),
}
name, base = sys.argv[1], sys.argv[2]
repo, remote = CFG[name]
TOP = 20
t0 = time.time()
model = CrossEncoder(repo, revision=PIN.get(repo), device=DEVICE, trust_remote_code=remote, max_length=512)
load_s = time.time() - t0
chunks = e.load_chunks()
golden = {q["id"]: q for q in e.load_golden()}
base_rank = json.load(open(f"results/{base}.json"))["rankings"]
if LIMIT:
    base_rank = dict(list(base_rank.items())[:LIMIT])
rankings, lat = {}, []
for qid, ranked in base_rank.items():
    top = ranked[:TOP]
    pairs = [(golden[qid]["q"], chunks[ci]["passage"]) for _p, _s, ci in top]
    t = time.perf_counter()
    scores = model.predict(pairs, batch_size=4, show_progress_bar=False)
    lat.append((time.perf_counter() - t) * 1000)
    order = sorted(zip(top, scores.tolist()), key=lambda x: -x[1])
    rankings[qid] = [[p, s, ci] for (p, _old, ci), s in order] + ranked[TOP:]
json.dump({
    "name": f"{base}+{name}" + ("" if DEVICE == "cpu" else "-" + DEVICE) + ("-lat" if LIMIT else ""), "repo": repo, "revision": PIN.get(repo), "load_s": round(load_s, 1),
    "rerank20_ms_p50": round(statistics.median(lat)), "rerank20_ms_p95": round(e.p95(lat)),
    "rss_peak_mb": e.peak_rss_mb(),
    "rankings": rankings, "device": DEVICE, "queries": len(rankings),
}, open(f"results/rerank-{base}+{name}{'' if DEVICE == 'cpu' else '-' + DEVICE}{'-lat' if LIMIT else ''}.json", "w"))
print(name, "done")
