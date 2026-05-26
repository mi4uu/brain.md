import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { renderMarkdown, isMediaName } from "../../web/src/renderer/render";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-e2e-"));
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

describe("e2e smoke (V7,V10)", () => {
  test("full flow: create, link, embed, render", async () => {
    // create two notes
    await put("/api/note/Welcome.md", "# Welcome\nGo to [[Project]] and tag #starter.");
    await put("/api/note/Project.md", "# Project\n- [ ] task one\n- [x] task two");

    // upload media
    const fd = new FormData();
    fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "diagram.png");
    const up = await h.app.handle(new Request("http://localhost/api/media/Welcome.md", { method: "POST", body: fd }));
    expect(up.status).toBe(200);

    // tree reflects everything
    const tree = await (await h.app.handle(new Request("http://localhost/api/tree"))).json() as { notes: string[] };
    expect(tree.notes).toEqual(["Project.md", "Welcome.md"]);

    // render Welcome — should resolve wikilink, render tag
    const note = await (await h.app.handle(new Request("http://localhost/api/note/Welcome.md"))).json() as { content: string };
    const { html } = renderMarkdown(
      `${note.content}\n![[diagram.png]]`,
      {
        resolveWikilink: (target) => (target.toLowerCase() === "project" ? "Project.md" : null),
        isMediaTarget: (target) => isMediaName(target),
        buildMediaUrl: (target) => `/api/media-raw/.media/${target}`,
      },
    );
    expect(html).toContain('class="wikilink"');
    expect(html).toContain('data-wikilink="Project"');
    expect(html).toContain('class="tag"');
    expect(html).toContain('<img src="/api/media-raw/.media/diagram.png"');

    // backlinks
    const bl = await (await h.app.handle(new Request("http://localhost/api/backlinks/Project.md"))).json() as Array<{ from: string }>;
    expect(bl[0]?.from).toBe("Welcome.md");

    // search
    const sr = await (await h.app.handle(new Request("http://localhost/api/search?q=Project"))).json() as Array<{ path: string }>;
    expect(sr.find((s) => s.path === "Project.md")).toBeDefined();

    // tasks aggregate
    const tasks = await (await h.app.handle(new Request("http://localhost/api/tasks"))).json() as Array<{ path: string; done: boolean }>;
    expect(tasks.length).toBe(2);

    // rename Project → Project2 patches inbound
    const ren = await h.app.handle(
      new Request("http://localhost/api/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "Project.md", to: "Project2.md" }),
      }),
    );
    expect(ren.status).toBe(200);
    const after = await (await h.app.handle(new Request("http://localhost/api/note/Welcome.md"))).json() as { content: string };
    expect(after.content).toContain("[[Project2]]");
  });
});
