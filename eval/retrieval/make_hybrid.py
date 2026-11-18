"""BM25 ranking file plus RRF hybrids of BM25 with every dense result."""
import glob, json
import evalcore as e
chunks = e.load_chunks()
golden = e.load_golden()
bm = e.BM25(chunks)
bm_rank = {q["id"]: e.doc_ranking(chunks, bm.chunk_scores(q["q"]), positive_only=True) for q in golden}
e.write_json("results/bm25.json", {"name": "bm25", "rankings": bm_rank})
# Every single-system dense result: sentence-transformers runs, GGUF runs,
# bge-m3 dense/sparse mixes and brain.md's own similar_notes.
DENSE = ("results/dense-*.json", "results/gguf-*.json", "results/bge-m3-*.json", "results/brainmd-similar*.json")
for f in sorted(p for g in DENSE for p in glob.glob(g)):
    d = json.load(open(f))
    hyb = {qid: e.rrf(bm_rank[qid], d["rankings"][qid]) for qid in bm_rank}
    name = f.split("/")[-1][:-5].replace("dense-", "")
    e.write_json(f"results/hybrid-{name}.json", {"name": f"hybrid-{name}", "rankings": hyb})
    print("hybrid", name)
