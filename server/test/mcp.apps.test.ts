import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, type AppHandle } from "../src/app";
import { NOTE_VIEW_META_KEY, NOTE_VIEW_URI } from "../src/mcp/apps";

const VIEW_HTML = "<!doctype html><html><body><div id=root></div></body></html>";

let dir!: string;
const handles: AppHandle[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-apps-"));
});
afterEach(async () => {
  handles.length = 0;
  await rm(dir, { recursive: true, force: true });
});

async function client(withView: boolean): Promise<{ c: Client; handle: AppHandle }> {
  const handle = createApp({
    vaultDir: dir,
    gitAutocommit: false,
    mcpViewLoader: withView ? async (name) => (name === "note" ? VIEW_HTML : null) : undefined,
  });
  handles.push(handle);
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      handle.app.handle(new Request(input, init))) as unknown as typeof fetch,
  });
  const c = new Client({ name: "test", version: "0.0.0" });
  await c.connect(transport);
  return { c, handle };
}

describe("MCP Apps note view", () => {
  test("read_note links to the ui:// view and write tools stay model-only", async () => {
    const { c } = await client(true);
    const { tools } = await c.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.read_note?._meta?.ui).toEqual({ resourceUri: NOTE_VIEW_URI });
    expect(byName.write_note?._meta?.ui).toEqual({ visibility: ["model"] });
    expect(byName.append_note?._meta?.ui).toEqual({ visibility: ["model"] });
  });

  test("the view is listed and readable as text/html;profile=mcp-app", async () => {
    const { c } = await client(true);
    const { resources } = await c.listResources();
    const view = resources.find((r) => r.uri === NOTE_VIEW_URI);
    expect(view?.mimeType).toBe("text/html;profile=mcp-app");
    const read = await c.readResource({ uri: NOTE_VIEW_URI });
    expect(read.contents[0]).toMatchObject({ uri: NOTE_VIEW_URI, mimeType: "text/html;profile=mcp-app", text: VIEW_HTML });
  });

  test("without a built view nothing is advertised", async () => {
    const { c } = await client(false);
    const { tools } = await c.listTools();
    expect(tools.find((t) => t.name === "read_note")?._meta?.ui).toBeUndefined();
    const { resources } = await c.listResources();
    expect(resources.some((r) => r.uri.startsWith("ui://"))).toBe(false);
  });

  test("read_note content is identical with and without the view; view data only in _meta", async () => {
    const texts: unknown[] = [];
    for (const withView of [true, false]) {
      const { c, handle } = await client(withView);
      await handle.vault.writeNote("a.md", "# A\n\nsee [[b]] and [[missing]]\n");
      await handle.vault.writeNote("b.md", "# B\n\nback to [[a]]\n");
      await handle.index.updatePath("a.md");
      await handle.index.updatePath("b.md");
      const r = await c.callTool({ name: "read_note", arguments: { path: "a.md" } });
      const parsed = JSON.parse((r.content as Array<{ text: string }>)[0]!.text) as { mtime?: unknown };
      delete parsed.mtime;
      texts.push(parsed);
      expect(r.structuredContent).toBeUndefined();
      const data = (r._meta as Record<string, unknown> | undefined)?.[NOTE_VIEW_META_KEY];
      if (withView) {
        expect(data).toEqual({
          backlinks: [{ from: "b.md", lineNo: 3, context: "back to [[a]]", embed: false }],
          links: { b: "b.md", missing: null },
        });
      } else {
        expect(data).toBeUndefined();
      }
    }
    expect(texts[0]).toEqual(texts[1]);
  });
});

describe("MCP tool annotations", () => {
  test("every tool is annotated; only write_note and append_note write", async () => {
    const { c } = await client(false);
    const { tools } = await c.listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.annotations).toBeDefined();
      const writes = t.name === "write_note" || t.name === "append_note";
      expect(t.annotations?.readOnlyHint).toBe(!writes);
    }
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.annotations]));
    expect(byName.write_note).toMatchObject({ destructiveHint: true, idempotentHint: true });
    expect(byName.append_note).toMatchObject({ destructiveHint: false, idempotentHint: false });
  });
});

describe("MCP Apps view data respects folder permissions", () => {
  test("an API key does not learn about notes in a folder it cannot read", async () => {
    const { handle } = await client(true);
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

    await handle.vault.writeNote("public/a.md", "# A\n\nsee [[s]]\n");
    await handle.vault.writeNote("secret/s.md", "# S\n\npoints at [[a]]\n");
    await handle.index.updatePath("public/a.md");
    await handle.index.updatePath("secret/s.md");
    expect((await req("/api/folder-mcp-perms", { path: "secret", read: false, write: true }, owner)).status).toBe(200);

    const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        handle.app.handle(new Request(input, init))) as unknown as typeof fetch,
      requestInit: { headers: { authorization: `Bearer ${key}` } },
    });
    const c = new Client({ name: "test", version: "0.0.0" });
    await c.connect(transport);
    const r = await c.callTool({ name: "read_note", arguments: { path: "public/a.md" } });
    const data = (r._meta as Record<string, unknown>)[NOTE_VIEW_META_KEY] as { backlinks: unknown[]; links: Record<string, unknown> };
    expect(data.backlinks).toEqual([]);
    expect(data.links).toEqual({ s: null });
  });
});
