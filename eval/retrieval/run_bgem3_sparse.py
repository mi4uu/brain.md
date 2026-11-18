"""bge-m3 dense + sparse (lexical weights) from one model: sparse alone and dense+sparse sums."""
import json, os, statistics, time
import numpy as np
from FlagEmbedding import BGEM3FlagModel
from huggingface_hub import snapshot_download
import evalcore as e
PIN = json.load(open(os.path.join(os.path.dirname(__file__), "pinned.json")))
m = BGEM3FlagModel(snapshot_download("BAAI/bge-m3", revision=PIN["BAAI/bge-m3"]), use_fp16=True)
chunks = e.load_chunks(); golden = e.load_golden()
t = time.time()
D = m.encode([c["passage"] for c in chunks], batch_size=16, max_length=512, return_dense=True, return_sparse=True)
index_s = time.time() - t
out = {}
for w_sparse in (0.0, 0.3, 1.0, None):
    rankings = {}
    for q in golden:
        Q = m.encode([q["q"]], return_dense=True, return_sparse=True)
        dense = D["dense_vecs"] @ Q["dense_vecs"][0]
        qs = Q["lexical_weights"][0]
        sparse = np.array([sum(float(w) * float(d.get(tok, 0)) for tok, w in qs.items()) for d in D["lexical_weights"]])
        score = sparse if w_sparse is None else dense + w_sparse * sparse
        rankings[q["id"]] = e.doc_ranking(chunks, score.tolist())
    name = "bge-m3-sparse-only" if w_sparse is None else f"bge-m3-dense+{w_sparse}sparse"
    e.write_json(f"results/{name}.json", {"name": name, "index_s": round(index_s, 1), "rankings": rankings})
    print(name)
