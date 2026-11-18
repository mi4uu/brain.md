"""GGUF embedder through llama-server /v1/embeddings: index on GPU, then query latency and RSS on one CPU thread."""
import json, os, statistics, subprocess, sys, time, urllib.request
import numpy as np
import evalcore as e

LLAMA = os.environ.get("LLAMA_SERVER", "llama-server")
name, gguf, qp, dp = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
CORE = os.environ.get("CPU_CORE", "4")

def serve(port, extra, pin=None):
    ctx = "8192" if pin is None else "4096"
    cmd = [LLAMA, "-m", gguf, "--embedding", "--host", "127.0.0.1", "--port", str(port), "-c", ctx, "-b", ctx, "-ub", ctx, "--no-webui"] + extra
    if pin:
        cmd = ["taskset", "-c", pin] + cmd
    env = dict(os.environ, CUDA_VISIBLE_DEVICES="") if pin else None
    p = subprocess.Popen(cmd, env=env, stdout=subprocess.DEVNULL, stderr=open(f"gguf-{name}-{port}.log", "w"))
    for _ in range(300):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2)
            return p
        except Exception:
            time.sleep(0.5)
    p.kill(); raise SystemExit("server did not start")

def embed(port, texts):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/embeddings", data=json.dumps({"input": texts}).encode(),
                                 headers={"content-type": "application/json"})
    data = json.load(urllib.request.urlopen(req, timeout=600))["data"]
    v = np.array([d["embedding"] for d in sorted(data, key=lambda d: d["index"])], dtype=np.float32)
    return v / np.linalg.norm(v, axis=1, keepdims=True)

chunks, golden = e.load_chunks(), e.load_golden()
os.makedirs("cache", exist_ok=True)
key = e.chunks_key(chunks, dp, "%s:%d" % (os.path.basename(gguf), os.path.getsize(gguf)))
cache = f"cache/gguf-{name}-{key}.npy"
if os.path.exists(cache):
    D = np.load(cache)
else:
    gpu_port = e.free_port()
    p = serve(gpu_port, ["-ngl", "99"])
    try:
        D = np.concatenate([embed(gpu_port, [dp + c["passage"] for c in chunks[i:i + 16]]) for i in range(0, len(chunks), 16)])
    finally:
        p.kill(); p.wait()
    np.save(cache, D)

cpu_port = e.free_port()
p = serve(cpu_port, ["-ngl", "0", "-t", "1", "-tb", "1"], pin=CORE)
try:
    embed(cpu_port, [qp + "warm up"])
    rankings, lat = {}, []
    for q in golden:
        t = time.perf_counter()
        qv = embed(cpu_port, [qp + q["q"]])[0]
        lat.append((time.perf_counter() - t) * 1000)
        rankings[q["id"]] = e.doc_ranking(chunks, (D @ qv).tolist())
    sample = [dp + c["passage"] for c in chunks[:40]]
    t = time.time()
    for i in range(0, len(sample), 4):
        embed(cpu_port, sample[i:i + 4])
    cps = round(len(sample) / (time.time() - t), 2)
    rss = int(next(l for l in open(f"/proc/{p.pid}/status") if l.startswith("VmHWM")).split()[1]) // 1024
finally:
    p.kill(); p.wait()
json.dump({"name": f"gguf-{name}", "gguf": os.path.basename(gguf), "query_ms_p50": round(statistics.median(lat), 1),
           "query_ms_p95": round(e.p95(lat), 1), "rss_peak_mb": rss, "chunks_per_s": cps,
           "device": "cpu-1thread", "rankings": rankings}, open(f"results/gguf-{name}.json", "w"))
print(name, "p50", round(statistics.median(lat), 1), "rss", rss, "cps", cps)
