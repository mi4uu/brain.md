"""CPU-only GGUF embedder bench: query latency, RSS, full reindex time and a single-note update."""
import collections, json, os, statistics, subprocess, sys, time, urllib.request
import evalcore as e

LLAMA = os.environ.get("LLAMA_SERVER", "llama-server")
THREADS = os.environ.get("THREADS", "4")
name, gguf, qp, dp = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
PORT = e.free_port()

def embed(texts):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/embeddings", data=json.dumps({"input": texts}).encode(),
                                 headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=3600))["data"]

def rss(pid):
    return int(next(l for l in open(f"/proc/{pid}/status") if l.startswith("VmHWM")).split()[1]) // 1024

cmd = [LLAMA, "-m", gguf, "--embedding", "--host", "127.0.0.1", "--port", str(PORT), "-c", "4096", "-b", "4096", "-ub", "4096",
       "--no-webui", "-t", THREADS, "-tb", THREADS]
p = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=open(f"bench-{name}.log", "w"))
try:
    for _ in range(240):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2); break
        except Exception:
            time.sleep(0.5)
    chunks, golden = e.load_chunks(), e.load_golden()
    embed([qp + "warm up"])
    lat = []
    for q in golden:
        t = time.perf_counter(); embed([qp + q["q"]]); lat.append((time.perf_counter() - t) * 1000)
    rss_query = rss(p.pid)
    per_note = collections.defaultdict(list)
    for c in chunks:
        per_note[c["path"]].append(dp + c["passage"])
    sizes = sorted(len(v) for v in per_note.values())
    median_n = sizes[len(sizes) // 2]
    note = next(v for v in per_note.values() if len(v) == median_n)
    big = max(per_note.values(), key=len)
    t = time.perf_counter(); embed(note); note_s = time.perf_counter() - t
    t = time.perf_counter(); embed(big); big_s = time.perf_counter() - t
    texts = [dp + c["passage"] for c in chunks]
    t = time.perf_counter()
    for i in range(0, len(texts), 8):
        embed(texts[i:i + 8])
    full_s = time.perf_counter() - t
    out = {"name": name, "threads": int(THREADS), "query_ms_p50": round(statistics.median(lat), 1),
           "query_ms_p95": round(e.p95(lat), 1), "rss_mb_after_queries": rss_query,
           "rss_mb_peak": rss(p.pid), "notes": len(per_note), "chunks": len(chunks),
           "median_note_chunks": median_n, "median_note_s": round(note_s, 2),
           "largest_note_chunks": len(big), "largest_note_s": round(big_s, 1),
           "full_reindex_s": round(full_s, 1), "chunks_per_s": round(len(chunks) / full_s, 2),
           "load": open("/proc/loadavg").read().split()[:3]}
    json.dump(out, open(f"results/bench-cpu-{name}.json", "w"))
    print(json.dumps(out))
finally:
    p.kill(); p.wait()
