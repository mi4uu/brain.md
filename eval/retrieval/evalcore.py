"""Shared pieces of the brain.md retrieval eval: data, BM25, fusion, metrics."""
import hashlib, json, math, re, resource, sys
from collections import Counter, defaultdict

def load_chunks(path="chunks.jsonl"):
    out = []
    for line in open(path):
        c = json.loads(line)
        if "/secrets/" in "/" + c["path"] or c["path"].startswith(".brain/"):
            continue
        title = c["path"].rsplit("/", 1)[-1].removesuffix(".md")
        c["passage"] = f"{title}\n{c['text']}"
        out.append(c)
    return out

def chunks_key(chunks, prefix=""):
    """Cache key for an embedding matrix: changes when the chunk set or the document prefix changes."""
    h = hashlib.sha1(prefix.encode())
    for c in chunks:
        h.update(c["passage"].encode())
    return h.hexdigest()[:12]

def peak_rss_mb():
    # ru_maxrss is bytes on macOS and KiB on Linux.
    r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return round(r / (1024 * 1024 if sys.platform == "darwin" else 1024))

def load_golden(path="golden.jsonl"):
    return [json.loads(l) for l in open(path)]

TOKEN = re.compile(r"\w+", re.UNICODE)
def tokens(s):
    return [t for t in TOKEN.findall(s.lower()) if len(t) > 1]

class BM25:
    """Plain Okapi BM25 over chunks: lowercase unicode word tokens, no stemming."""
    def __init__(self, chunks, k1=1.2, b=0.75):
        self.chunks = chunks
        self.docs = [Counter(tokens(c["passage"])) for c in chunks]
        self.len = [sum(d.values()) for d in self.docs]
        self.avg = sum(self.len) / len(self.len)
        df = Counter()
        for d in self.docs:
            df.update(d.keys())
        n = len(self.docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.k1, self.b = k1, b
    def chunk_scores(self, q):
        qt = tokens(q)
        out = []
        for d, L in zip(self.docs, self.len):
            s = 0.0
            for t in qt:
                f = d.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * L / self.avg))
            out.append(s)
        return out

def doc_ranking(chunks, chunk_scores, k=50):
    """Note score = best chunk score; returns [(path, score, best_chunk_idx)] sorted."""
    best = {}
    for i, (c, s) in enumerate(zip(chunks, chunk_scores)):
        if c["path"] not in best or s > best[c["path"]][0]:
            best[c["path"]] = (s, i)
    ranked = sorted(best.items(), key=lambda kv: -kv[1][0])
    return [(p, s, i) for p, (s, i) in ranked[:k] if s > 0]

def rrf(*rankings, k=60, top=50):
    score = defaultdict(float)
    best_chunk = {}
    for r in rankings:
        for rank, (p, _s, ci) in enumerate(r):
            score[p] += 1.0 / (k + rank + 1)
            best_chunk.setdefault(p, ci)
    ranked = sorted(score.items(), key=lambda kv: -kv[1])[:top]
    return [(p, s, best_chunk[p]) for p, s in ranked]

def metrics(ranked_paths, rel):
    rel = set(rel)
    hits10 = [p for p in ranked_paths[:10] if p in rel]
    recall10 = len(hits10) / len(rel)
    mrr = 0.0
    for i, p in enumerate(ranked_paths[:10]):
        if p in rel:
            mrr = 1.0 / (i + 1)
            break
    dcg = sum(1.0 / math.log2(i + 2) for i, p in enumerate(ranked_paths[:10]) if p in rel)
    idcg = sum(1.0 / math.log2(i + 2) for i in range(min(len(rel), 10)))
    return {"recall@10": recall10, "mrr@10": mrr, "ndcg@10": dcg / idcg}
