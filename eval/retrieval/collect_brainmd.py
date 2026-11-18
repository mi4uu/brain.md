"""Rankings from the running brain.md (search_notes and similar_notes code paths)."""
import json, os, statistics, time, urllib.parse, urllib.request
import evalcore as e
golden = e.load_golden()
chunks = e.load_chunks()
first_chunk = {}
for i, c in enumerate(chunks):
    first_chunk.setdefault(c["path"], i)
def get(path):
    with urllib.request.urlopen(os.environ.get("BRAINMD_URL", "http://localhost:3000") + path, timeout=60) as r:
        return json.load(r)
for name, url in [("brainmd-search", "/api/search?q={q}"), ("brainmd-similar", "/api/similar?k=50&q={q}")]:
    rankings, lat = {}, []
    for q in golden:
        t = time.perf_counter()
        hits = get(url.format(q=urllib.parse.quote(q["q"])))
        lat.append((time.perf_counter() - t) * 1000)
        seen, ranked = set(), []
        for h in hits:
            p = h["path"]
            if p in seen or p not in first_chunk:
                continue
            seen.add(p)
            ci = next((i for i, c in enumerate(chunks) if c["path"] == p and c["idx"] == h.get("chunkIndex", 0)), first_chunk[p])
            ranked.append([p, h.get("score", 0), ci])
        rankings[q["id"]] = ranked[:50]
    e.write_json(f"results/{name}.json", {"name": name, "query_ms_p50": round(statistics.median(lat), 1), "rankings": rankings})
    print(name, "p50 ms", round(statistics.median(lat), 1))
