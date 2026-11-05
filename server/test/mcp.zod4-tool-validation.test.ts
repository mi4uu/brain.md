import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Regression for the server/zod 3 -> 4 migration (security-4): confirms
// the MCP SDK still validates tool input against the zod schemas in
// mcp/server.ts, and that a large but well-typed scope array is validated
// promptly instead of hanging.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-zod4-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function appFetch(): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    handle.app.handle(new Request(input, init))) as unknown as typeof fetch;
}

async function mcpClient(): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: appFetch(),
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("mcp tool input validation (zod 4)", () => {
  test("search_notes rejects a missing required field", async () => {
    const client = await mcpClient();
    const res = await client.callTool({ name: "search_notes", arguments: {} });
    expect(res.isError).toBeTruthy();
  });

  test("search_notes accepts a large well-typed scope array without hanging", async () => {
    const client = await mcpClient();
    const scope = Array.from({ length: 5000 }, (_, i) => `folder-${i}`);
    const start = Date.now();
    const res = await client.callTool({
      name: "search_notes",
      arguments: { query: "x", scope },
    });
    expect(Date.now() - start).toBeLessThan(5000);
    expect(res.isError).toBeFalsy();
  });
});
