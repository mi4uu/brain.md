import glob, json, statistics
from collections import defaultdict
import evalcore as e
golden = e.load_golden()
bm = json.load(open("results/bm25.json"))["rankings"]
def wrrf(a, b, wa, wb, k=60):
    s = defaultdict(float); ci = {}
    for w, r in ((wa, a), (wb, b)):
        for rank, (p, _s, c) in enumerate(r):
            s[p] += w / (k + rank + 1); ci.setdefault(p, c)
    return [p for p, _ in sorted(s.items(), key=lambda kv: -kv[1])]
def blend(a, b, alpha):
    def norm(r):
        if not r: return {}
        vals = [x[1] for x in r]; lo, hi = min(vals), max(vals)
        return {p: (s - lo) / (hi - lo + 1e-9) for p, s, _ in r}
    na, nb = norm(a), norm(b)
    keys = set(na) | set(nb)
    return [p for p in sorted(keys, key=lambda p: -((1 - alpha) * nb.get(p, 0) + alpha * na.get(p, 0)))]
def score(rank_fn):
    return statistics.mean(e.metrics(rank_fn(q), q["rel"])["ndcg@10"] for q in golden)
for f in sorted(glob.glob("results/dense-*.json")):
    name = f.split("/")[-1][6:-5]
    d = json.load(open(f))["rankings"]
    row = [f"dense {score(lambda q: [p for p,*_ in d[q['id']]]):.3f}"]
    for wb in (1.0, 0.5, 0.25):
        row.append(f"rrf bm{wb} {score(lambda q: wrrf(bm[q['id']], d[q['id']], wb, 1.0)):.3f}")
    for al in (0.1, 0.2, 0.3):
        row.append(f"blend {al} {score(lambda q: blend(bm[q['id']], d[q['id']], al)):.3f}")
    print(name, " | ".join(row))
