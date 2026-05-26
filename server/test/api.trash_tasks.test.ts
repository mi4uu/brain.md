import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-tt-"));
  h = createApp({ vaultDir: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(p: string, content: string) {
  return h.app.handle(
    new Request(`http://localhost${p}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

describe("trash + restore", () => {
  test("delete → list → restore", async () => {
    await put("/api/note/x.md", "deleted soon");
    await h.app.handle(new Request("http://localhost/api/note/x.md", { method: "DELETE" }));
    const list = await h.app.handle(new Request("http://localhost/api/trash"));
    const items = (await list.json()) as Array<{ path: string; isDir: boolean }>;
    const file = items.find((i) => i.path.endsWith("/x.md"));
    expect(file).toBeDefined();

    const restore = await h.app.handle(
      new Request("http://localhost/api/trash/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trashPath: file!.path }),
      }),
    );
    expect(restore.status).toBe(200);
    const after = await h.app.handle(new Request("http://localhost/api/note/x.md"));
    expect(after.status).toBe(200);
    const body = (await after.json()) as { content: string };
    expect(body.content).toBe("deleted soon");
  });
});

describe("tasks aggregate", () => {
  test("returns parsed tasks across vault", async () => {
    await put("/api/note/a.md", "- [ ] do this\n- [x] done it");
    await put("/api/note/sub/b.md", "* [ ] second\n+ [X] third");
    await put("/api/note/none.md", "no tasks here");
    const res = await h.app.handle(new Request("http://localhost/api/tasks"));
    const tasks = (await res.json()) as Array<{ path: string; done: boolean; text: string }>;
    expect(tasks.length).toBe(4);
    expect(tasks.find((t) => t.text === "do this")?.done).toBe(false);
    expect(tasks.find((t) => t.text === "done it")?.done).toBe(true);
    expect(tasks.find((t) => t.text === "third")?.done).toBe(true);
  });
});
