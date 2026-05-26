import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let handle: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-tree-"));
  handle = createApp({ vaultDir: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function get(p: string) {
  return new Request(`http://localhost${p}`);
}
function post(p: string, body?: unknown) {
  return new Request(`http://localhost${p}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
function del(p: string) {
  return new Request(`http://localhost${p}`, { method: "DELETE" });
}
function put(p: string, body: unknown) {
  return new Request(`http://localhost${p}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("tree + folder API", () => {
  test("empty tree", async () => {
    const r = await handle.app.handle(get("/api/tree"));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { folders: string[]; notes: string[] };
    expect(body.folders).toEqual([]);
    expect(body.notes).toEqual([]);
  });

  test("mkdir folder + tree reflects + delete folder", async () => {
    const mk = await handle.app.handle(post("/api/folder/Docs"));
    expect(mk.status).toBe(200);

    const noteRes = await handle.app.handle(
      put("/api/note/Docs/a.md", { content: "x" }),
    );
    expect(noteRes.status).toBe(200);

    const tree = await handle.app.handle(get("/api/tree"));
    const body = (await tree.json()) as { folders: string[]; notes: string[] };
    expect(body.folders).toEqual(["Docs"]);
    expect(body.notes).toEqual(["Docs/a.md"]);

    const delRes = await handle.app.handle(del("/api/folder/Docs"));
    expect(delRes.status).toBe(200);

    const tree2 = await handle.app.handle(get("/api/tree"));
    const body2 = (await tree2.json()) as { folders: string[]; notes: string[] };
    expect(body2.folders).toEqual([]);
    expect(body2.notes).toEqual([]);
  });
});
