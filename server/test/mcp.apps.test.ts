import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, type AppHandle } from "../src/app";
import { NOTE_VIEW_URI } from "../src/mcp/apps";

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

  test("read_note result is identical with and without the view", async () => {
    const results: unknown[] = [];
    for (const withView of [true, false]) {
      const { c, handle } = await client(withView);
      await handle.vault.writeNote("a.md", "# A\n\nsee [[b]]\n");
      const r = await c.callTool({ name: "read_note", arguments: { path: "a.md" } });
      const parsed = JSON.parse((r.content as Array<{ text: string }>)[0]!.text) as { mtime?: unknown };
      delete parsed.mtime;
      results.push({ ...r, content: [parsed] });
      expect(r.structuredContent).toBeUndefined();
    }
    expect(results[0]).toEqual(results[1]);
  });
});
