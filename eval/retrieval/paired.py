"""Paired bootstrap of nDCG@10 differences, overall and on real queries only."""
import glob, json, random, statistics
import evalcore as e
golden = {q["id"]: q for q in e.load_golden()}
res = {}
for f in glob.glob("results/*.json"):
    d = json.load(open(f))
    res[d["name"]] = {q: e.metrics([r[0] for r in d["rankings"].get(q, [])], golden[q]["rel"])["ndcg@10"] for q in golden}
pairs = [
    ("embeddinggemma-300m", "bge-m3-dense+0.3sparse"),
    ("embeddinggemma-300m", "f2llm-v2-0.6b"),
    ("embeddinggemma-300m", "mmlw-base"),
    ("embeddinggemma-300m", "hybrid-brainmd-similar"),
    ("f2llm-v2-0.6b", "hybrid-f2llm-v2-0.6b-cuda"),
    ("hybrid-f2llm-v2-0.6b-cuda+polish-reranker-v2", "f2llm-v2-0.6b"),
    ("dense-f2llm-v2-0.6b-cuda+polish-reranker-v2", "f2llm-v2-0.6b"),
    ("bm25+polish-reranker-v2", "bm25"),
    ("bm25+polish-reranker-v2", "embeddinggemma-300m"),
    ("hybrid-brainmd-similar", "brainmd-similar"),
]
random.seed(7)
pairs = [(a, b) for a, b in pairs if a in res and b in res]
for sub in ("all", "real"):
    ids = [q for q in golden if sub == "all" or golden[q]["type"] == "real"]
    if not ids:
        continue
    print(f"--- {sub} (n={len(ids)})")
    for a, b in pairs:
        d = [res[a][q] - res[b][q] for q in ids]
        boots = sorted(statistics.mean(random.choices(d, k=len(d))) for _ in range(5000))
        w = sum(x > 1e-9 for x in d); l = sum(x < -1e-9 for x in d)
        print(f"{a[:44]:44} vs {b[:30]:30} {statistics.mean(d):+.3f} CI95 [{boots[125]:+.3f},{boots[4874]:+.3f}] w/l {w}/{l}")
