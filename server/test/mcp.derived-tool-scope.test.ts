import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Embedder } from "../src/rag/provider";
import type { ProviderId } from "../src/rag/types";

// Regression for Codex r2 #7: a vault:write-only OAuth token could read
// full note content through semantic_outline, context_for_query,
// find_orphans, weekly_digest, and compare_notes, none of which enforced
// the token's own read scope (only read_note/get_backlinks/find_related
// did). And #8: the passwordless "open" principal must respect folder
// MCP permissions over MCP, even though it fully bypasses them on REST.

class FakeEmbedder implements Embedder {
  readonly providerId: ProviderId = "local";
  readonly modelId = "fake-model";
  constructor(readonly dim: number) {}
  async ready(): Promise<void> {}
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array(this.dim).fill(1));
  }
}

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-scope-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function appFetch(): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    handle.app.handle(new Request(input, init))) as unknown as typeof fetch;
}

async function mcpClient(bearer?: string): Promise<Client> {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: appFetch(),
    requestInit: { headers },
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const r = await handle.app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

describe("MCP derived RAG tools enforce OAuth read scope", () => {
  beforeEach(async () => {
    (handle.ragPipeline as unknown as { embedder: Embedder }).embedder = new FakeEmbedder(
      handle.ragStore.dim,
    );
    await call("PATCH", "/api/settings", { rag: { enabled: true } });
    await handle.vault.writeNote("public/b.md", "# B\n\nsome body text\n");
    await handle.index.updatePath("public/b.md");
    await handle.ragPipeline.indexNote("public/b.md");
    await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
    await handle.authStore.load();
  });

  test("vault:write-only token gets nothing from semantic_outline", async () => {
    const pair = handle.oauthStore.issueTokenPair({
      clientId: "c",
      scope: "vault:write",
      resource: "http://localhost/mcp",
    });
    const client = await mcpClient(pair.accessToken);
    const res = await client.callTool({
      name: "semantic_outline",
      arguments: { path: "public/b.md" },
    });
    const text = JSON.stringify(res.content);
    expect(text).not.toContain("some body text");
    await client.close();
  });

  test("vault:write-only token gets nothing from context_for_query", async () => {
    const pair = handle.oauthStore.issueTokenPair({
      clientId: "c",
      scope: "vault:write",
      resource: "http://localhost/mcp",
    });
    const client = await mcpClient(pair.accessToken);
    const res = await client.callTool({
      name: "context_for_query",
      arguments: { query: "body text" },
    });
    const text = JSON.stringify(res.content);
    expect(text).not.toContain("some body text");
    expect(text).not.toContain("public/b.md");
    await client.close();
  });

  test("vault:write-only token's compare_notes is refused", async () => {
    await handle.vault.writeNote("public/c.md", "# C\n\nother body\n");
    await handle.index.updatePath("public/c.md");
    await handle.ragPipeline.indexNote("public/c.md");
    const pair = handle.oauthStore.issueTokenPair({
      clientId: "c",
      scope: "vault:write",
      resource: "http://localhost/mcp",
    });
    const client = await mcpClient(pair.accessToken);
    const res = await client.callTool({
      name: "compare_notes",
      arguments: { a: "public/b.md", b: "public/c.md" },
    });
    expect(res.isError).toBeTruthy();
    await client.close();
  });

  test("vault:read token still gets content from semantic_outline", async () => {
    const pair = handle.oauthStore.issueTokenPair({
      clientId: "c",
      scope: "vault:read",
      resource: "http://localhost/mcp",
    });
    const client = await mcpClient(pair.accessToken);
    const res = await client.callTool({
      name: "semantic_outline",
      arguments: { path: "public/b.md" },
    });
    const text = JSON.stringify(res.content);
    expect(text).toContain("some body text");
    await client.close();
  });
});

describe("MCP respects folder perms in passwordless mode (Codex r2 #8 regression)", () => {
  test("read_note on a denied folder is refused over MCP even with no password set", async () => {
    await handle.vault.writeNote("secret/a.md", "top secret\n");
    await handle.index.updatePath("secret/a.md");
    // No password configured — set a folder restriction anyway (the
    // folder-mcp-perms route is reachable in this mode by design).
    await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: true });

    const client = await mcpClient();
    const res = await client.callTool({ name: "read_note", arguments: { path: "secret/a.md" } });
    expect(res.isError).toBeTruthy();
    await client.close();
  });

  test("the same restriction does not block the REST/web UI in passwordless mode", async () => {
    await handle.vault.writeNote("secret/a.md", "top secret\n");
    await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: true });

    const r = await call("GET", "/api/note/secret/a.md");
    expect(r.status).toBe(200);
  });
});
