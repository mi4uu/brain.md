import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-search-"));
  h = createApp({ vaultDir: dir });
  await put("/api/note/alpha.md", { content: "# Alpha\nfoo bar baz" });
  await put("/api/note/sub/beta.md", { content: "# Beta\nthe quick brown fox" });
  await put("/api/note/gamma.md", { content: "#tagged stuff about foo" });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, body: unknown) {
  return h.app.handle(
    new Request(`http://localhost${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("search API", () => {
  test("returns matches sorted by score", async () => {
    const res = await h.app.handle(new Request("http://localhost/api/search?q=foo"));
    expect(res.status).toBe(200);
    const hits = (await res.json()) as Array<{ path: string; score: number }>;
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.map((x) => x.path)).toContain("alpha.md");
    expect(hits.map((x) => x.path)).toContain("gamma.md");
  });

  test("title hit ranks above body hit", async () => {
    const res = await h.app.handle(new Request("http://localhost/api/search?q=Alpha"));
    const hits = (await res.json()) as Array<{ path: string; score: number }>;
    expect(hits[0]!.path).toBe("alpha.md");
  });

  test("empty query → empty results", async () => {
    const res = await h.app.handle(new Request("http://localhost/api/search?q="));
    const hits = (await res.json()) as unknown[];
    expect(hits).toEqual([]);
  });

  test("case-insensitive", async () => {
    const res = await h.app.handle(new Request("http://localhost/api/search?q=FOX"));
    const hits = (await res.json()) as Array<{ path: string }>;
    expect(hits[0]!.path).toBe("sub/beta.md");
  });
});
