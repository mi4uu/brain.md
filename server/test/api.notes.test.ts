import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let handle: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-api-"));
  handle = createApp({ vaultDir: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function req(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("notes API", () => {
  test("PUT then GET round trip", async () => {
    const put = await handle.app.handle(
      req("PUT", "/api/note/hello.md", { content: "# hi" }),
    );
    expect(put.status).toBe(200);
    const putBody = (await put.json()) as { path: string; mtime: number };
    expect(putBody.path).toBe("hello.md");
    expect(putBody.mtime).toBeGreaterThan(0);

    const get = await handle.app.handle(
      req("GET", "/api/note/hello.md"),
    );
    expect(get.status).toBe(200);
    const body = (await get.json()) as { content: string };
    expect(body.content).toBe("# hi");
  });

  test("PUT non-md → 400", async () => {
    const res = await handle.app.handle(
      req("PUT", "/api/note/foo.txt", { content: "x" }),
    );
    expect(res.status).toBe(400);
  });

  test("GET url-encoded traversal → 400", async () => {
    const res = await handle.app.handle(
      req("GET", "/api/note/%2E%2E%2F%2E%2E%2Fetc%2Fpasswd"),
    );
    expect(res.status).toBe(400);
  });

  test("GET missing → 404", async () => {
    const res = await handle.app.handle(req("GET", "/api/note/nope.md"));
    expect(res.status).toBe(404);
  });

  test("DELETE moves to trash, then GET 404", async () => {
    await handle.app.handle(
      req("PUT", "/api/note/del.md", { content: "z" }),
    );
    const del = await handle.app.handle(req("DELETE", "/api/note/del.md"));
    expect(del.status).toBe(200);
    const body = (await del.json()) as { ok: boolean; trashed: string };
    expect(body.ok).toBe(true);
    expect(body.trashed.startsWith(".brain/trash/")).toBe(true);
    const get = await handle.app.handle(req("GET", "/api/note/del.md"));
    expect(get.status).toBe(404);
  });

  test("nested PUT creates parent dirs", async () => {
    const put = await handle.app.handle(
      req("PUT", "/api/note/a/b/c.md", { content: "deep" }),
    );
    expect(put.status).toBe(200);
    const get = await handle.app.handle(req("GET", "/api/note/a/b/c.md"));
    const body = (await get.json()) as { content: string };
    expect(body.content).toBe("deep");
  });
});

// V-concurrency #9: optimistic concurrency so overlapping autosaves can't
// silently replace newer edits with older content.
describe("notes API — optimistic concurrency", () => {
  test("GET returns a revision", async () => {
    await handle.app.handle(req("PUT", "/api/note/r.md", { content: "v1" }));
    const get = await handle.app.handle(req("GET", "/api/note/r.md"));
    const body = (await get.json()) as { revision: string };
    expect(typeof body.revision).toBe("string");
    expect(body.revision.length).toBeGreaterThan(0);
  });

  test("PUT without baseRevision always succeeds (back-compat)", async () => {
    await handle.app.handle(req("PUT", "/api/note/s.md", { content: "v1" }));
    const res = await handle.app.handle(req("PUT", "/api/note/s.md", { content: "v2" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: string };
    expect(typeof body.revision).toBe("string");
  });

  test("PUT with matching baseRevision succeeds and returns a new revision", async () => {
    const first = await handle.app.handle(req("PUT", "/api/note/t.md", { content: "v1" }));
    const { revision } = (await first.json()) as { revision: string };
    const second = await handle.app.handle(
      req("PUT", "/api/note/t.md", { content: "v2", baseRevision: revision }),
    );
    expect(second.status).toBe(200);
    const body = (await second.json()) as { revision: string };
    expect(body.revision).not.toBe(revision);
  });

  test("PUT with stale baseRevision → 409 CONFLICT, no write", async () => {
    const first = await handle.app.handle(req("PUT", "/api/note/u.md", { content: "v1" }));
    const { revision: v1 } = (await first.json()) as { revision: string };
    // A second writer updates the note first (simulating a concurrent save).
    await handle.app.handle(req("PUT", "/api/note/u.md", { content: "v2 (winner)" }));

    const conflict = await handle.app.handle(
      req("PUT", "/api/note/u.md", { content: "v3 (loser, stale base)", baseRevision: v1 }),
    );
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { code: string; revision: string };
    expect(body.code).toBe("CONFLICT");
    expect(body.revision).not.toBe(v1);

    const get = await handle.app.handle(req("GET", "/api/note/u.md"));
    const got = (await get.json()) as { content: string };
    expect(got.content).toBe("v2 (winner)");
  });

  test("creating a new note with a baseRevision doesn't conflict against an absent file", async () => {
    const res = await handle.app.handle(
      req("PUT", "/api/note/brand-new.md", { content: "hello", baseRevision: "deadbeef" }),
    );
    expect(res.status).toBe(200);
  });

  test("two concurrent PUTs to the same note don't corrupt it (last write under lock wins cleanly)", async () => {
    await handle.app.handle(req("PUT", "/api/note/race.md", { content: "base" }));
    const [a, b] = await Promise.all([
      handle.app.handle(req("PUT", "/api/note/race.md", { content: "from A" })),
      handle.app.handle(req("PUT", "/api/note/race.md", { content: "from B" })),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const get = await handle.app.handle(req("GET", "/api/note/race.md"));
    const body = (await get.json()) as { content: string };
    expect(["from A", "from B"]).toContain(body.content);
  });
});
