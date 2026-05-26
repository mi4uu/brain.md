import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let handle: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-media-"));
  handle = createApp({ vaultDir: dir });
  await handle.app.handle(
    new Request("http://localhost/api/note/n.md", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    }),
  );
  await handle.app.handle(
    new Request("http://localhost/api/note/Folder/m.md", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "y" }),
    }),
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function uploadReq(notePath: string, filename: string, bytes: Uint8Array) {
  const fd = new FormData();
  const blob = new Blob([bytes as unknown as BlobPart], { type: "image/png" });
  fd.append("file", blob, filename);
  return new Request(`http://localhost/api/media/${notePath}`, {
    method: "POST",
    body: fd,
  });
}

describe("media API", () => {
  test("upload to root note → /.media/", async () => {
    const res = await handle.app.handle(
      uploadReq("n.md", "img.png", new Uint8Array([1, 2, 3, 4])),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      url: string;
      path: string;
      name: string;
    };
    expect(body.path).toBe(".media/img.png");
    expect(body.url).toBe("/api/media-raw/.media/img.png");
    const s = await stat(join(dir, ".media/img.png"));
    expect(s.size).toBe(4);
  });

  test("upload to nested note → <dir>/.media/", async () => {
    const res = await handle.app.handle(
      uploadReq("Folder/m.md", "p.png", new Uint8Array([9])),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe("Folder/.media/p.png");
  });

  test("serve uploaded media bytes", async () => {
    await handle.app.handle(
      uploadReq("n.md", "img.png", new Uint8Array([7, 8, 9])),
    );
    const get = await handle.app.handle(
      new Request("http://localhost/api/media-raw/.media/img.png"),
    );
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("image/png");
    const buf = new Uint8Array(await get.arrayBuffer());
    expect(Array.from(buf)).toEqual([7, 8, 9]);
  });

  test("reject filename with slash", async () => {
    const res = await handle.app.handle(
      uploadReq("n.md", "../evil.png", new Uint8Array([0])),
    );
    expect(res.status).toBe(400);
  });
});
