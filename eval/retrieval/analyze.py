"""Metrics per result file, per query type, and paired wins/losses against a reference."""
import glob
import json
import statistics
import sys

import evalcore as e

golden = {q["id"]: q for q in e.load_golden()}
ref_name = sys.argv[1] if len(sys.argv) > 1 else "hybrid-brainmd-similar"
only = sys.argv[2] if len(sys.argv) > 2 else ""


def per_query(res):
    # A run limited to some queries (LIMIT) scores the rest as empty rankings.
    return {qid: e.metrics([r[0] for r in res["rankings"].get(qid, [])], golden[qid]["rel"]) for qid in golden}


rows = {}
for f in sorted(glob.glob("results/*.json")):
    res = json.load(open(f))
    if only and only not in res["name"]:
        continue
    rows[res["name"]] = (res, per_query(res))
ref = None
for f in glob.glob("results/*.json"):
    res = json.load(open(f))
    if res["name"] == ref_name:
        ref = per_query(res)

types = sorted({q["type"] for q in golden.values()})


def mean(pq, key, ids):
    return statistics.mean(pq[i][key] for i in ids)


head = "{:60} {:>5} {:>5} {:>5} | {} | {:^9} | {}".format(
    "system", "R@10", "MRR", "nDCG", " ".join("{:>9}".format(t[:9]) for t in types), "win/loss", "ms p50"
)
print(head)
ordered = sorted(rows.items(), key=lambda kv: -mean(kv[1][1], "ndcg@10", list(golden)))
for name, (res, pq) in ordered:
    ids = list(golden)
    by_type = " ".join(
        "{:9.3f}".format(mean(pq, "ndcg@10", [i for i in ids if golden[i]["type"] == t])) for t in types
    )
    wl = ""
    if ref:
        w = sum(1 for i in ids if pq[i]["ndcg@10"] > ref[i]["ndcg@10"] + 1e-9)
        l = sum(1 for i in ids if pq[i]["ndcg@10"] < ref[i]["ndcg@10"] - 1e-9)
        wl = "{}/{}".format(w, l)
    ms = res.get("query_ms_p50") or res.get("rerank20_ms_p50") or ""
    print(
        "{:60} {:5.3f} {:5.3f} {:5.3f} | {} | {:^9} | {}".format(
            name[:60], mean(pq, "recall@10", ids), mean(pq, "mrr@10", ids), mean(pq, "ndcg@10", ids), by_type, wl, ms
        )
    )
print("types:", {t: sum(1 for q in golden.values() if q["type"] == t) for t in types})
