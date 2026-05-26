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
