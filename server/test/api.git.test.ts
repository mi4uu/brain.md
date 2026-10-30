import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-api-git-"));
  h = createApp({ vaultDir: dir, gitAutocommit: true, gitDebounceMs: 50 });
  await h.repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, content: string) {
  await h.app.handle(
    new Request(`http://localhost${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

describe("git API", () => {
  test("status reports enabled + head", async () => {
    const res = await h.app.handle(new Request("http://localhost/api/git/status"));
    const s = (await res.json()) as { enabled: boolean; head: string | null };
    expect(s.enabled).toBe(true);
    expect(s.head).toBeTruthy();
  });

  test("write → flush autocommit → log + show + restore", async () => {
    await put("/api/note/a.md", "first");
    await h.autocommit.flush();
    await put("/api/note/a.md", "second");
    await h.autocommit.flush();
    const log = await (await h.app.handle(new Request("http://localhost/api/git/log?path=a.md"))).json() as Array<{ sha: string; subject: string }>;
    expect(log.length).toBeGreaterThanOrEqual(2);
    const firstSha = log[log.length - 1]!.sha;
    const show = await (await h.app.handle(new Request(`http://localhost/api/git/show?sha=${firstSha}&path=a.md`))).json() as { content: string };
    expect(show.content.trim()).toBe("first");
    const restore = await h.app.handle(
      new Request("http://localhost/api/git/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "a.md", sha: firstSha }),
      }),
    );
    expect(restore.status).toBe(200);
    const note = await (await h.app.handle(new Request("http://localhost/api/note/a.md"))).json() as { content: string };
    expect(note.content.trim()).toBe("first");
    // V-concurrency #18: git restore writes straight to the working tree,
    // bypassing Vault's own write methods, the full-text index must still
    // pick it up (via vault.notifyWrite) instead of serving the pre-restore
    // content forever.
    const indexed = h.index.get("a.md");
    expect(indexed?.body.trim()).toBe("first");
  });

  test("restore refuses a traversal path", async () => {
    await put("/api/note/a.md", "first");
    await h.autocommit.flush();
    const restore = await h.app.handle(
      new Request("http://localhost/api/git/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "../../etc/passwd", sha: "HEAD" }),
      }),
    );
    expect(restore.status).toBe(400);
  });

  test("restore refuses a .brain/ path", async () => {
    await put("/api/note/a.md", "first");
    await h.autocommit.flush();
    const restore = await h.app.handle(
      new Request("http://localhost/api/git/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: ".brain/auth.json", sha: "HEAD" }),
      }),
    );
    expect(restore.status).toBe(400);
  });

  test("restore refuses a non-markdown path", async () => {
    await put("/api/note/a.md", "first");
    await h.autocommit.flush();
    const restore = await h.app.handle(
      new Request("http://localhost/api/git/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "a.txt", sha: "HEAD" }),
      }),
    );
    expect(restore.status).toBe(400);
  });

  test("manual commit", async () => {
    await put("/api/note/x.md", "manual");
    const res = await h.app.handle(
      new Request("http://localhost/api/git/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hand-written" }),
      }),
    );
    const body = (await res.json()) as { sha: string };
    expect(body.sha).toBeTruthy();
  });

  test("checkpoint creates tag", async () => {
    await put("/api/note/y.md", "tag me");
    const res = await h.app.handle(
      new Request("http://localhost/api/git/checkpoint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "milestone" }),
      }),
    );
    const body = (await res.json()) as { sha: string; tag: string };
    expect(body.tag.startsWith("cp-")).toBe(true);
  });

  test("autocommit toggle", async () => {
    const res = await h.app.handle(
      new Request("http://localhost/api/git/autocommit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
    );
    const body = (await res.json()) as { enabled: boolean };
    expect(body.enabled).toBe(false);
  });
});
