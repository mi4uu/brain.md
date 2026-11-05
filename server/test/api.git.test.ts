import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-api-git-"));
  // Large debounce: every test flushes explicitly, nothing here relies
  // on the debounce timer firing on its own. A short one risked it firing
  // mid-test (git subprocesses are not instant) and resolving after the
  // test's own teardown had already removed its directory.
  h = createApp({ vaultDir: dir, gitAutocommit: true, gitDebounceMs: 60_000 });
  await h.repo.ensure();
});

afterEach(async () => {
  // See autocommit.ts's module comment: an undisposed instance can hold a
  // live retry timer that must not outlive this test's temp directory.
  h.autocommit.dispose();
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

  // Audit P0: restore used to call commitAll(msg) with no `paths`, which
  // stages and commits EVERYTHING dirty in the working tree, not just the
  // restored file.
  test("restore scopes its commit to the restored path, leaving other dirty files pending", async () => {
    await put("/api/note/a.md", "first");
    await h.autocommit.flush();
    await put("/api/note/a.md", "second");
    await h.autocommit.flush();
    const log = (await (await h.app.handle(new Request("http://localhost/api/git/log?path=a.md"))).json()) as Array<{ sha: string }>;
    const firstSha = log[log.length - 1]!.sha;

    // Dirty, unrelated to the restore, and never flushed.
    await put("/api/note/b.md", "unrelated, still pending");

    const restore = await h.app.handle(
      new Request("http://localhost/api/git/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "a.md", sha: firstSha }),
      }),
    );
    expect(restore.status).toBe(200);
    const { sha } = (await restore.json()) as { sha: string };
    const show = Bun.spawnSync(["git", "-C", dir, "show", "--name-status", "-1", sha]);
    const names = show.stdout.toString();
    expect(names).toContain("a.md");
    expect(names).not.toContain("b.md");
    const status = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]);
    expect(status.stdout.toString()).toContain("b.md");
  });

  // Audit P0: a directory literally named "x.md" passes assertMarkdown's
  // suffix check; restoring onto it must not recurse into it.
  test("restore refuses a target that is a directory named *.md", async () => {
    await mkdir(join(dir, "folder.md"), { recursive: true });
    await writeFile(join(dir, "folder.md", "inner.md"), "inner");
    await h.autocommit.flush();
    const restore = await h.app.handle(
      new Request("http://localhost/api/git/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: "folder.md", sha: "HEAD" }),
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
