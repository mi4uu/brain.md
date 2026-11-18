import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import type { VaultGraph } from "../src/index/graph";

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-graph-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(path: string, content: string): Promise<void> {
  await handle.vault.writeNote(path, content);
  await handle.index.updatePath(path);
}

async function req(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return handle.app.handle(new Request(`http://localhost${path}`, { ...init, headers }));
}

async function graph(token?: string): Promise<VaultGraph> {
  const r = await req("/api/graph", {}, token);
  expect(r.status).toBe(200);
  return (await r.json()) as VaultGraph;
}

function edgeSet(g: VaultGraph): string[] {
  return g.links.map((l) => [l.source, l.target].sort().join(" <-> ")).sort();
}

describe("GET /api/graph", () => {
  test("nodes for every note, deduped undirected edges, no self links", async () => {
    await write("a.md", "# A\n\n[[b]] and [[b]] and [[a]]\n");
    await write("b.md", "# B\n\nback to [[a]]\n");
    await write("lonely.md", "# Lonely\n");
    const g = await graph();
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["a.md", "b.md", "lonely.md"]);
    expect(edgeSet(g)).toEqual(["a.md <-> b.md"]);
  });

  test("resolves path-qualified, basename and alias links, each on its own", async () => {
    await write("work/x/target.md", "---\naliases: [Goal]\n---\n# T\n");
    await write("other/thing.md", "# Other\n");
    await write("by-path.md", "[[work/x/target]]\n");
    await write("by-alias.md", "[[Goal]]\n");
    await write("by-name.md", "[[thing]]\n");
    await write("dangling.md", "[[nowhere]]\n");
    const g = await graph();
    expect(edgeSet(g)).toEqual([
      "by-alias.md <-> work/x/target.md",
      "by-name.md <-> other/thing.md",
      "by-path.md <-> work/x/target.md",
    ]);
    expect(g.nodes.find((n) => n.id === "work/x/target.md")?.folder).toBe("work");
    expect(g.nodes.find((n) => n.id === "by-path.md")?.folder).toBe("");
  });

  test("an API key never sees notes or edges in a folder it cannot read", async () => {
    await write("public/a.md", "# A\n\nsee [[s]]\n");
    await write("secret/s.md", "# S\n\nsee [[a]]\n");
    expect((await req("/api/auth/set", { method: "POST", body: JSON.stringify({ newPassword: "hunter2hunter2" }) })).status).toBe(200);
    await handle.authStore.load();
    const owner = ((await (await req("/api/auth/login", { method: "POST", body: JSON.stringify({ password: "hunter2hunter2" }) })).json()) as { token: string }).token;
    const key = ((await (await req("/api/auth/keys", { method: "POST", body: JSON.stringify({ name: "agent" }) }, owner)).json()) as { token: string }).token;
    expect((await req("/api/folder-mcp-perms", { method: "POST", body: JSON.stringify({ path: "secret", read: false, write: true }) }, owner)).status).toBe(200);

    const g = await graph(key);
    expect(g.nodes.map((n) => n.id)).toEqual(["public/a.md"]);
    expect(g.links).toEqual([]);
    const full = await graph(owner);
    expect(full.nodes.length).toBe(2);
    expect(full.links.length).toBe(1);
  });
});
