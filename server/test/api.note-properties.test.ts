import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h!: AppHandle;
let dir!: string;
let ownerToken!: string;
let apiKey!: string;

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await h.app.handle(new Request(`http://localhost${path}`, init));
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

const read = (p: string) => readFile(join(dir, p), "utf8");

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-note-props-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  await h.vault.writeNote("a.md", "---\n# keep me\nid: 007\nstatus:   todo   # why\ntags:\n- x\n- y\n---\n\n# A\n");
  await h.vault.writeNote("plain.md", "# plain\n");
  await h.vault.writeNote("bad.md", "---\na: [1\n---\nbody\n");
  await h.vault.writeNote("secret/s.md", "---\nk: v\n---\nbody\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("PATCH /api/note-properties/*", () => {
  test("sets and unsets, touching only the changed lines", async () => {
    const r = await call("PATCH", "/api/note-properties/a.md", { set: { status: "done", due: "2026-12-01" }, unset: ["id"] });
    expect(r.status).toBe(200);
    expect(r.json.path).toBe("a.md");
    expect(r.json.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(await read("a.md")).toBe("---\n# keep me\nstatus:   done   # why\ntags:\n- x\n- y\ndue: 2026-12-01\n---\n\n# A\n");
  });

  test("the edit is a normal write: the index sees it", async () => {
    await call("PATCH", "/api/note-properties/a.md", { set: { status: "done" } });
    expect(h.index.get("a.md")!.props.status).toBe("done");
  });

  test("creates a frontmatter block on a note without one", async () => {
    await call("PATCH", "/api/note-properties/plain.md", { set: { status: "new" } });
    expect(await read("plain.md")).toBe("---\nstatus: new\n---\n# plain\n");
  });

  test("a matching baseRevision succeeds, a stale one is 409 with the current revision", async () => {
    const note = (await call("GET", "/api/note/a.md")).json;
    const ok = await call("PATCH", "/api/note-properties/a.md", { set: { status: "x" }, baseRevision: note.revision });
    expect(ok.status).toBe(200);
    const stale = await call("PATCH", "/api/note-properties/a.md", { set: { status: "y" }, baseRevision: note.revision });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe("CONFLICT");
    expect(stale.json.revision).toBe(ok.json.revision);
    expect((await read("a.md"))).toContain("status:   x   # why");
  });

  test("invalid YAML is 422 INVALID_YAML and the note is untouched", async () => {
    const before = await read("bad.md");
    const r = await call("PATCH", "/api/note-properties/bad.md", { set: { a: 1 } });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("INVALID_YAML");
    expect(await read("bad.md")).toBe(before);
  });

  test("an unresolved alias or a flow-style mapping is 422 INVALID_YAML and the note is untouched", async () => {
    const notes = {
      "alias.md": "---\nnote: *important*\n---\nbody\n",
      "flow.md": "---\n{a: 1, b: 2}\n---\nbody\n",
      "anchor.md": "---\nbase: &b hi\ncopy: *b\n---\nbody\n",
    };
    for (const [p, c] of Object.entries(notes)) await h.vault.writeNote(p, c);
    for (const [p, body] of [["alias.md", { set: { z: 1 } }], ["flow.md", { unset: ["a"] }], ["anchor.md", { unset: ["base"] }]] as const) {
      const r = await call("PATCH", `/api/note-properties/${p}`, body);
      expect(r.status).toBe(422);
      expect(r.json.code).toBe("INVALID_YAML");
      expect(await read(p)).toBe(notes[p]);
    }
  });

  test("a frontmatter that is a list is 422 NOT_A_MAPPING", async () => {
    await h.vault.writeNote("list.md", "---\n- a\n- b\n---\nbody\n");
    const r = await call("PATCH", "/api/note-properties/list.md", { set: { a: 1 } });
    expect(r.status).toBe(422);
    expect(r.json.code).toBe("NOT_A_MAPPING");
  });

  test("missing note is 404 and nothing is created", async () => {
    const r = await call("PATCH", "/api/note-properties/nope.md", { set: { a: 1 } });
    expect(r.status).toBe(404);
    expect((await call("GET", "/api/note/nope.md")).status).toBe(404);
  });

  test("a no-op edit writes nothing", async () => {
    const before = await h.vault.readNote("a.md");
    const r = await call("PATCH", "/api/note-properties/a.md", { set: { status: "todo" } });
    expect(r.status).toBe(200);
    expect((await h.vault.readNote("a.md")).mtime).toBe(before.mtime);
  });

  test("bad input: nothing to do, __proto__, too many keys, non-md path", async () => {
    expect((await call("PATCH", "/api/note-properties/a.md", {})).status).toBe(400);
    expect((await call("PATCH", "/api/note-properties/a.md", { set: JSON.parse('{"__proto__": 1}') })).status).toBe(400);
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i]));
    expect((await call("PATCH", "/api/note-properties/a.md", { set: many })).status).toBe(400);
    expect((await call("PATCH", "/api/note-properties/a.txt", { set: { a: 1 } })).status).toBe(400);
  });

  test("unset removes a key named like an Object.prototype member", async () => {
    await h.vault.writeNote("proto.md", "---\nconstructor: x\ntoString: y\n---\nbody\n");
    const before = (await call("GET", "/api/note/proto.md")).json.revision;
    const r = await call("PATCH", "/api/note-properties/proto.md", { unset: ["constructor", "toString"] });
    expect(r.status).toBe(200);
    expect(r.json.revision).not.toBe(before);
    expect(await read("proto.md")).toBe("---\n\n---\nbody\n");
  });

  test("concurrent edits to different keys both land", async () => {
    await Promise.all([
      call("PATCH", "/api/note-properties/a.md", { set: { one: 1 } }),
      call("PATCH", "/api/note-properties/a.md", { set: { two: 2 } }),
      call("PATCH", "/api/note-properties/a.md", { set: { three: 3 } }),
    ]);
    expect(h.index.get("a.md")!.props).toMatchObject({ one: 1, two: 2, three: 3 });
  });
});

describe("PATCH /api/note-properties permissions", () => {
  beforeEach(async () => {
    await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
    await h.authStore.load();
    const login = await call("POST", "/api/auth/login", { password: "hunter2hunter2" });
    ownerToken = login.json.token;
    apiKey = (await call("POST", "/api/auth/keys", { name: "agent" }, ownerToken)).json.token;
    await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: false }, ownerToken);
    await call("POST", "/api/folder-mcp-perms", { path: "dropbox", read: false, write: true }, ownerToken);
    await h.vault.writeNote("dropbox/d.md", "---\nk: v\n---\nbody\n");
  });

  test("a denied folder is 403 for an API key and fine for the owner", async () => {
    expect((await call("PATCH", "/api/note-properties/secret/s.md", { set: { a: 1 } }, apiKey)).status).toBe(403);
    expect((await call("PATCH", "/api/note-properties/secret/s.md", { set: { a: 1 } }, ownerToken)).status).toBe(200);
  });

  test("a write-only folder: the edit works, but no revision comes back and base_revision is refused", async () => {
    const ok = await call("PATCH", "/api/note-properties/dropbox/d.md", { set: { a: 1 } }, apiKey);
    expect(ok.status).toBe(200);
    expect(ok.json.revision).toBeUndefined();
    const guarded = await call("PATCH", "/api/note-properties/dropbox/d.md", { set: { a: 2 }, baseRevision: "x" }, apiKey);
    expect(guarded.status).toBe(403);
  });

  test("a write-only caller gets a generic YAML error, not a quote of the source", async () => {
    await h.vault.writeNote("dropbox/bad.md", "---\nsecretword: [1\n---\n");
    const r = await call("PATCH", "/api/note-properties/dropbox/bad.md", { set: { a: 1 } }, apiKey);
    expect(r.status).toBe(422);
    expect(JSON.stringify(r.json)).not.toContain("secretword");
  });
});
