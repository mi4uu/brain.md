import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-bl-"));
  h = createApp({ vaultDir: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(p: string, content: string) {
  await h.app.handle(
    new Request(`http://localhost${p}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

describe("backlinks API", () => {
  test("returns inbound link entries", async () => {
    await put("/api/note/target.md", "I am target");
    await put("/api/note/a.md", "see [[target]] here");
    await put("/api/note/b.md", "also [[Target]]");
    const res = await h.app.handle(
      new Request("http://localhost/api/backlinks/target.md"),
    );
    const body = (await res.json()) as Array<{ from: string }>;
    const sources = body.map((x) => x.from).sort();
    expect(sources).toEqual(["a.md", "b.md"]);
  });

  test("empty when no inbound", async () => {
    await put("/api/note/lonely.md", "x");
    const res = await h.app.handle(
      new Request("http://localhost/api/backlinks/lonely.md"),
    );
    const body = (await res.json()) as unknown[];
    expect(body).toEqual([]);
  });
});
