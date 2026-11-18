"""BM25 ranking file plus RRF hybrids of BM25 with every dense result."""
import glob, json
import evalcore as e
chunks = e.load_chunks()
golden = e.load_golden()
bm = e.BM25(chunks)
bm_rank = {q["id"]: e.doc_ranking(chunks, bm.chunk_scores(q["q"])) for q in golden}
json.dump({"name": "bm25", "rankings": bm_rank}, open("results/bm25.json", "w"))
for f in sorted(glob.glob("results/dense-*.json")) + glob.glob("results/brainmd-similar.json"):
    d = json.load(open(f))
    hyb = {qid: e.rrf(bm_rank[qid], d["rankings"][qid]) for qid in bm_rank}
    name = f.split("/")[-1][:-5].replace("dense-", "")
    json.dump({"name": f"hybrid-{name}", "rankings": hyb}, open(f"results/hybrid-{name}.json", "w"))
    print("hybrid", name)
