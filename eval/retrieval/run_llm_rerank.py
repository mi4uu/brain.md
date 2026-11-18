"""Zero-shot LLM reranking through llama-swap: score = P(yes) of the first answer token."""
import json, math, os, statistics, sys, time, urllib.request
import evalcore as e

URL = os.environ.get("LLM_URL", "http://localhost:8080")
KEY = os.environ.get("LLM_KEY", "")
SYSTEM = "You judge search results. Answer with exactly one word: yes or no."
TOP = 20

def post(path, body, timeout=120):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(), headers={
        "content-type": "application/json", "authorization": f"Bearer {KEY}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def p_yes(model, query, doc):
    body = {
        "model": model, "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 20,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "system", "content": SYSTEM},
                     {"role": "user", "content": f"Query: {query}\n\nDocument:\n{doc[:2000]}\n\nIs the document relevant to the query? Answer yes or no."}],
    }
    r = post("/v1/chat/completions", body)
    top = r["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
    yes = sum(math.exp(t["logprob"]) for t in top if t["token"].strip().lower() == "yes")
    no = sum(math.exp(t["logprob"]) for t in top if t["token"].strip().lower() == "no")
    return yes / (yes + no) if yes + no > 0 else 0.0

def rerank_endpoint(model, query, docs):
    r = post("/v1/rerank", {"model": model, "query": query, "documents": docs})
    out = [0.0] * len(docs)
    for item in r["results"]:
        out[item["index"]] = item["relevance_score"]
    return out

def main():
    model, base = sys.argv[1], sys.argv[2]
    use_rerank_api = model == "qwen3-reranker"
    chunks = e.load_chunks()
    golden = {q["id"]: q for q in e.load_golden()}
    base_rank = json.load(open(f"results/{base}.json"))["rankings"]
    if use_rerank_api:
        rerank_endpoint(model, "warm up", ["warm up"])
    else:
        p_yes(model, "warm up", "warm up")
    rankings, lat = {}, []
    for qid, ranked in base_rank.items():
        top = ranked[:TOP]
        t = time.perf_counter()
        if use_rerank_api:
            scores = rerank_endpoint(model, golden[qid]["q"], [chunks[ci]["passage"] for _p, _s, ci in top])
        else:
            scores = [p_yes(model, golden[qid]["q"], chunks[ci]["passage"]) for _p, _s, ci in top]
        lat.append((time.perf_counter() - t) * 1000)
        order = sorted(zip(top, scores), key=lambda x: -x[1])
        rankings[qid] = [[p, s, ci] for (p, _o, ci), s in order] + ranked[TOP:]
    json.dump({"name": f"{base}+llm-{model}", "model": model, "where": "llm",
               "rerank20_ms_p50": round(statistics.median(lat)), "rerank20_ms_p95": round(sorted(lat)[int(len(lat) * 0.95) - 1]),
               "rankings": rankings}, open(f"results/rerank-{base}+llm-{model}.json", "w"))
    print(model, "done", round(statistics.median(lat)))

if __name__ == "__main__":
    main()
