import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, type AppHandle } from "../src/app";
import { GRAPH_VIEW_META_KEY, GRAPH_VIEW_URI } from "../src/mcp/apps";

let dir!: string;
let handle!: AppHandle;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-graph-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup(withView: boolean, token?: string): Promise<Client> {
  handle ??= createApp({
    vaultDir: dir,
    gitAutocommit: false,
    mcpViewLoader: withView ? async (name) => `<!doctype html><title>${name}</title>` : undefined,
  });
  return connect(token);
}

async function connect(token?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      handle.app.handle(new Request(input, init))) as unknown as typeof fetch,
    requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
  });
  const c = new Client({ name: "test", version: "0.0.0" });
  await c.connect(transport);
  return c;
}

async function write(path: string, content: string): Promise<void> {
  await handle.vault.writeNote(path, content);
  await handle.index.updatePath(path);
}

function text(r: Awaited<ReturnType<Client["callTool"]>>): string {
  return (r.content as Array<{ text: string }>)[0]!.text;
}

describe("graph_view", () => {
  beforeEach(() => {
    handle = undefined as unknown as AppHandle;
  });

  test("summarises the vault; view data only when the view is built", async () => {
    for (const withView of [false, true]) {
      handle = undefined as unknown as AppHandle;
      const c = await setup(withView);
      await write("hub.md", "[[a]] [[b]] [[c]]\n");
      await write("a.md", "[[b]]\n");
      await write("b.md", "# B\n");
      await write("c.md", "# C\n");
      await write("lone.md", "# Lone\n");
      const r = await c.callTool({ name: "graph_view", arguments: {} });
      expect(text(r)).toContain("Graph of the vault: 5 notes, 4 links, 1 without links.");
      expect(text(r)).toContain("Most linked: hub.md (3)");
      const data = (r._meta as Record<string, unknown> | undefined)?.[GRAPH_VIEW_META_KEY] as
        | { nodes: unknown[]; links: unknown[]; truncated: boolean }
        | undefined;
      if (withView) {
        expect(data?.nodes.length).toBe(5);
        expect(data?.links.length).toBe(4);
        expect(data?.truncated).toBe(false);
        const { tools } = await c.listTools();
        expect(tools.find((t) => t.name === "graph_view")?._meta?.ui).toEqual({ resourceUri: GRAPH_VIEW_URI });
        const read = await c.readResource({ uri: GRAPH_VIEW_URI });
        expect(read.contents[0]?.mimeType).toBe("text/html;profile=mcp-app");
      } else {
        expect(data).toBeUndefined();
      }
      await rm(join(dir, ".brain"), { recursive: true, force: true });
    }
  });

  test("center and depth, and folder filter", async () => {
    const c = await setup(true);
    await write("a.md", "[[b]]\n");
    await write("b.md", "[[c]]\n");
    await write("c.md", "[[d]]\n");
    await write("d.md", "# D\n");
    await write("w/x.md", "[[w/y]]\n");
    await write("w/y.md", "# Y\n");
    const one = await c.callTool({ name: "graph_view", arguments: { center: "b.md" } });
    expect(text(one)).toContain("Graph of b.md (1 hop): 3 notes, 2 links");
    const two = await c.callTool({ name: "graph_view", arguments: { center: "b.md", depth: 2 } });
    expect(text(two)).toContain("4 notes, 3 links");
    const w = await c.callTool({ name: "graph_view", arguments: { folder: "w" } });
    expect(text(w)).toContain("Graph of folder w: 2 notes, 1 links");
  });

  test("an API key sees nothing from a folder it cannot read", async () => {
    await setup(true);
    await write("public/a.md", "[[s]]\n");
    await write("secret/s.md", "[[a]]\n");
    const req = (path: string, body: unknown, token?: string) =>
      handle.app.handle(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
        }),
      );
    expect((await req("/api/auth/set", { newPassword: "hunter2hunter2" })).status).toBe(200);
    await handle.authStore.load();
    const owner = ((await (await req("/api/auth/login", { password: "hunter2hunter2" })).json()) as { token: string }).token;
    const key = ((await (await req("/api/auth/keys", { name: "agent" }, owner)).json()) as { token: string }).token;
    expect((await req("/api/folder-mcp-perms", { path: "secret", read: false, write: true }, owner)).status).toBe(200);

    const c = await connect(key);
    const r = await c.callTool({ name: "graph_view", arguments: {} });
    expect(text(r)).toContain("1 notes, 0 links");
    expect(JSON.stringify(r)).not.toContain("secret");
    const denied = await c.callTool({ name: "graph_view", arguments: { center: "secret/s.md" } });
    expect(denied.isError).toBe(true);
  });
});
