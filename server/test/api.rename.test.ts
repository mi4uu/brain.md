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

  // V-concurrency #21: moving a note across folders must rewrite
  // path-qualified wikilinks ([[work/A]]) to the new path, not just bare
  // basename links, and must not bail out early just because the
  // basename happens to be unchanged.
  test("folder move rewrites path-qualified wikilinks", async () => {
    await put("/api/note/work/A.md", "content");
    await put("/api/note/linker.md", "see [[work/A]] and [[work/A#Section|alias]]");

    const res = await rename("work/A.md", "archive/A.md");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { patchedFiles: string[]; totalReplacements: number };
    expect(body.patchedFiles).toEqual(["linker.md"]);
    expect(body.totalReplacements).toBe(2);
    expect(await getContent("/api/note/linker.md")).toBe(
      "see [[archive/A]] and [[archive/A#Section|alias]]",
    );
  });

  test("folder move with unchanged basename still processes the vault (no early return)", async () => {
    await put("/api/note/work/A.md", "content");
    await put("/api/note/other.md", "unrelated [[other-thing]]");
    const res = await rename("work/A.md", "archive/A.md");
    expect(res.status).toBe(200);
    // Nothing to patch in other.md, but the call must still succeed and
    // leave it untouched rather than throwing or skipping the whole vault.
    expect(await getContent("/api/note/other.md")).toBe("unrelated [[other-thing]]");
  });

  test("bare basename link left alone when ambiguous between two notes", async () => {
    await put("/api/note/work/A.md", "one");
    await put("/api/note/other/A.md", "two");
    await put("/api/note/linker.md", "[[A]]");
    await rename("work/A.md", "work/Renamed.md");
    // "A" also refers to other/A.md, a bare link can't be safely rewritten.
    expect(await getContent("/api/note/linker.md")).toBe("[[A]]");
  });
});
