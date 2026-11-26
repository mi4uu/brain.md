import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function put(path: string, content: string) {
  await h.vault.writeNote(path, content);
  await h.index.updatePath(path);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-api-props-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  await put("a.md", "---\nstatus: todo\nprio: 1\n---\n");
  await put("b.md", "---\nstatus: done\nprio: 2\n---\n");
  await put("secret/s.md", "---\nstatus: top\nclearance: 9\n---\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function lockDown() {
  await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
  await h.authStore.load();
  const login = await call("POST", "/api/auth/login", { password: "hunter2hunter2" });
  ownerToken = login.json.token;
  const key = await call("POST", "/api/auth/keys", { name: "agent" }, ownerToken);
  apiKey = key.json.token;
  await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: false }, ownerToken);
}

describe("GET /api/properties", () => {
  test("lists keys with counts, types and values", async () => {
    const r = await call("GET", "/api/properties");
    expect(r.status).toBe(200);
    const byName = Object.fromEntries((r.json as Array<{ name: string }>).map((i) => [i.name, i]));
    expect(byName.status).toMatchObject({ count: 3, type: "text" });
    expect(byName.prio).toMatchObject({ count: 2, type: "number", values: expect.arrayContaining([1, 2]) });
  });

  test("a type in .brain/types.json wins over inference; unknown strings read as text", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify({ types: { prio: "text", status: "from-the-future" } }));
    const r = await call("GET", "/api/properties");
    const byName = Object.fromEntries((r.json as Array<{ name: string; type: string }>).map((i) => [i.name, i]));
    expect(byName.prio!.type).toBe("text");
    expect(byName.status!.type).toBe("text");
  });

  test(".obsidian/types.json fills in keys brain.md has no entry for; brain.md wins on conflict", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    await mkdir(join(dir, ".obsidian"), { recursive: true });
    await writeFile(join(dir, ".obsidian/types.json"), JSON.stringify({ types: { prio: "multitext", status: "multitext" } }));
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify({ types: { status: "text" } }));
    const r = await call("GET", "/api/properties");
    const byName = Object.fromEntries((r.json as Array<{ name: string; type: string }>).map((i) => [i.name, i]));
    expect(byName.prio!.type).toBe("multitext");
    expect(byName.status!.type).toBe("text");
  });

  test("tags and aliases keep their fixed type whatever the registry says", async () => {
    await put("t.md", "---\ntags: [x]\naliases: [y]\n---\n");
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify({ types: { tags: "text", aliases: "text" } }));
    const r = await call("GET", "/api/properties");
    const byName = Object.fromEntries((r.json as Array<{ name: string; type: string }>).map((i) => [i.name, i]));
    expect(byName.tags!.type).toBe("tags");
    expect(byName.aliases!.type).toBe("aliases");
  });

  test("a key used only in an unreadable folder is not listed, and its values do not leak", async () => {
    await lockDown();
    const owner = await call("GET", "/api/properties", undefined, ownerToken);
    expect(JSON.stringify(owner.json)).toContain("clearance");
    const agent = await call("GET", "/api/properties", undefined, apiKey);
    expect(agent.status).toBe(200);
    expect(JSON.stringify(agent.json)).not.toContain("clearance");
    expect(JSON.stringify(agent.json)).not.toContain("top");
  });
});

describe("PUT /api/properties/types", () => {
  test("writes .brain/types.json in Obsidian's shape and GET reflects it", async () => {
    const r = await call("PUT", "/api/properties/types", { name: "prio", type: "text" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    const file = JSON.parse(await readFile(join(dir, ".brain/types.json"), "utf8"));
    expect(file).toEqual({ types: { prio: "text" } });
    const list = await call("GET", "/api/properties");
    expect((list.json as Array<{ name: string; type: string }>).find((i) => i.name === "prio")!.type).toBe("text");
  });

  test("keeps entries it does not understand and entries for other keys", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify({ types: { old: "future-type" } }));
    await call("PUT", "/api/properties/types", { name: "prio", type: "number" });
    const file = JSON.parse(await readFile(join(dir, ".brain/types.json"), "utf8"));
    expect(file).toEqual({ types: { old: "future-type", prio: "number" } });
  });

  test("keeps non-string entries and other top-level keys on write", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    const before = { version: 2, extra: { keep: true }, types: { old: "text", weird: 5, obj: { x: 1 } } };
    await writeFile(join(dir, ".brain/types.json"), JSON.stringify(before));
    await call("PUT", "/api/properties/types", { name: "prio", type: "number" });
    const file = JSON.parse(await readFile(join(dir, ".brain/types.json"), "utf8"));
    expect(file).toEqual({ ...before, types: { ...before.types, prio: "number" } });
  });

  test("a corrupt types file is not overwritten", async () => {
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/types.json"), "{ not json");
    const r = await call("PUT", "/api/properties/types", { name: "prio", type: "number" });
    expect(r.status).toBe(500);
    expect(await readFile(join(dir, ".brain/types.json"), "utf8")).toBe("{ not json");
  });

  test("rejects an unknown type, an empty name and __proto__", async () => {
    expect((await call("PUT", "/api/properties/types", { name: "x", type: "bogus" })).status).toBe(422);
    expect((await call("PUT", "/api/properties/types", { name: "", type: "text" })).status).toBe(422);
    const proto = await call("PUT", "/api/properties/types", { name: "__proto__", type: "text" });
    expect(proto.status).toBe(400);
    expect(proto.json.code).toBe("INVALID_VALUE");
  });

  test("an API key cannot change types; the owner can", async () => {
    await lockDown();
    const denied = await call("PUT", "/api/properties/types", { name: "prio", type: "text" }, apiKey);
    expect(denied.status).toBe(403);
    const ok = await call("PUT", "/api/properties/types", { name: "prio", type: "text" }, ownerToken);
    expect(ok.status).toBe(200);
  });

  test("concurrent changes to different keys both land", async () => {
    await Promise.all([
      call("PUT", "/api/properties/types", { name: "a", type: "text" }),
      call("PUT", "/api/properties/types", { name: "b", type: "number" }),
      call("PUT", "/api/properties/types", { name: "c", type: "date" }),
    ]);
    const file = JSON.parse(await readFile(join(dir, ".brain/types.json"), "utf8"));
    expect(file.types).toEqual({ a: "text", b: "number", c: "date" });
  });
});

describe("hidden notes", () => {
  test("a hidden note contributes no keys and no values; search: false notes stay", async () => {
    await put("h.md", "---\nhidden: true\nhiddenkey: hv-unique\nstatus: hs-unique\n---\n");
    await put("ns.md", "---\nsearch: false\nnskey: nv\n---\n");
    const r = await call("GET", "/api/properties");
    const text = JSON.stringify(r.json);
    expect(text).not.toContain("hiddenkey");
    expect(text).not.toContain("hv-unique");
    expect(text).not.toContain("hs-unique");
    expect(text).toContain("nskey");
    const status = (r.json as Array<{ name: string; count: number }>).find((i) => i.name === "status")!;
    expect(status.count).toBe(3);
  });
});
