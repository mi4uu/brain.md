import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-rename-"));
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

async function rename(from: string, to: string) {
  return h.app.handle(
    new Request("http://localhost/api/rename", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    }),
  );
}

async function getContent(p: string): Promise<string> {
  const r = await h.app.handle(new Request(`http://localhost${p}`));
  const body = (await r.json()) as { content: string };
  return body.content;
}

describe("rename + V5 inbound patch", () => {
  test("renames file and rewrites inbound wikilinks", async () => {
    await put("/api/note/Old.md", "I am old");
    await put("/api/note/a.md", "see [[Old]] and ![[Old]]\n[[Old|alias]]");
    await put("/api/note/b.md", "unrelated");

    const ren = await rename("Old.md", "New.md");
    expect(ren.status).toBe(200);
    const body = (await ren.json()) as { patchedFiles: string[]; totalReplacements: number };
    expect(body.patchedFiles).toEqual(["a.md"]);
    expect(body.totalReplacements).toBe(3);

    expect(await getContent("/api/note/New.md")).toBe("I am old");
    expect(await getContent("/api/note/a.md")).toBe("see [[New]] and ![[New]]\n[[New|alias]]");
    expect(await getContent("/api/note/b.md")).toBe("unrelated");
  });

  test("preserves section anchors in links", async () => {
    await put("/api/note/Old.md", "x");
    await put("/api/note/c.md", "[[Old#Section]]");
    const res = await rename("Old.md", "Renamed.md");
    expect(res.status).toBe(200);
    expect(await getContent("/api/note/c.md")).toBe("[[Renamed#Section]]");
  });

  test("refuses overwrite existing target", async () => {
    await put("/api/note/x.md", "x");
    await put("/api/note/y.md", "y");
    const res = await rename("x.md", "y.md");
    expect(res.status).toBe(409);
  });

  test("rename into subfolder", async () => {
    await put("/api/note/root.md", "x");
    await put("/api/note/sub/.gitkeep.md", "y");
    const res = await rename("root.md", "sub/root.md");
    expect(res.status).toBe(200);
    expect(await getContent("/api/note/sub/root.md")).toBe("x");
  });
});
