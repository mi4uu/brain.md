import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Drives real MCP tool calls through the HTTP app (not direct function
// calls) so these tests exercise the same path a real MCP client hits:
// auth-middleware's principal resolution -> mcp/server.ts's permission
// checks. Only `fetch` is swapped for one that calls the Elysia app
// in-process instead of opening a socket.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-perms-"));
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

async function setPassword(password: string): Promise<void> {
  const r = await handle.app.handle(
    new Request("http://localhost/api/auth/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: password }),
    }),
  );
  expect(r.status).toBe(200);
}

async function login(password: string): Promise<string> {
  const r = await handle.app.handle(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
  const j = (await r.json()) as { token: string };
  return j.token;
}

async function createApiKey(ownerToken: string): Promise<string> {
  const r = await handle.app.handle(
    new Request("http://localhost/api/auth/keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ name: "agent" }),
    }),
  );
  expect(r.status).toBe(200);
  const j = (await r.json()) as { token: string };
  return j.token;
}

async function denyRead(ownerToken: string, path: string): Promise<void> {
  const r = await handle.app.handle(
    new Request("http://localhost/api/folder-mcp-perms", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({ path, read: false, write: true }),
    }),
  );
  expect(r.status).toBe(200);
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  return client.callTool({ name, arguments: args });
}

describe("MCP folder-perm filtering (unauthenticated — back-compat)", () => {
  test("search_notes / list_tags / get_tasks skip denied folders", async () => {
    await handle.vault.writeNote("secret/a.md", "# A\n\nsearchable-term here\n- [ ] do thing #tag1\n");
    await handle.vault.writeNote("public/b.md", "# B\n\nsearchable-term also here\n- [ ] other #tag2\n");
    await handle.index.updatePath("secret/a.md");
    await handle.index.updatePath("public/b.md");

    // Auth stays unconfigured for this block (back-compat: unrestricted).
    const client = await mcpClient();
    const searchBefore = await callTool(client, "search_notes", { query: "searchable-term" });
    const beforeText = JSON.stringify(searchBefore.content);
    expect(beforeText).toContain("secret/a.md");
    await client.close();
  });
});

describe("MCP folder-perm filtering with auth configured", () => {
  let ownerToken!: string;

  beforeEach(async () => {
    await setPassword("hunter2hunter2");
    await handle.authStore.load();
    ownerToken = await login("hunter2hunter2");
    await handle.vault.writeNote("secret/a.md", "# A\n\nsearchable-term here\n- [ ] do thing #secrettag\n");
    await handle.vault.writeNote("public/b.md", "# B\n\nsearchable-term also here\n- [ ] other #publictag\n");
    await handle.index.updatePath("secret/a.md");
    await handle.index.updatePath("public/b.md");
    await denyRead(ownerToken, "secret");
  });

  test("owner session sees everything (full bypass)", async () => {
    const client = await mcpClient(ownerToken);
    const hits = await callTool(client, "search_notes", { query: "searchable-term" });
    expect(JSON.stringify(hits.content)).toContain("secret/a.md");
    await client.close();
  });

  test("API key is filtered by folder perms: search/tags/tasks/backlinks", async () => {
    const key = await createApiKey(ownerToken);
    const client = await mcpClient(key);

    const hits = await callTool(client, "search_notes", { query: "searchable-term" });
    expect(JSON.stringify(hits.content)).not.toContain("secret/a.md");
    expect(JSON.stringify(hits.content)).toContain("public/b.md");

    const tags = await callTool(client, "list_tags", {});
    expect(JSON.stringify(tags.content)).not.toContain("secrettag");
    expect(JSON.stringify(tags.content)).toContain("publictag");

    const tasks = await callTool(client, "get_tasks", {});
    expect(JSON.stringify(tasks.content)).not.toContain("secret/a.md");
    expect(JSON.stringify(tasks.content)).toContain("public/b.md");

    await client.close();
  });

  test("API key read_note on denied folder is refused", async () => {
    const key = await createApiKey(ownerToken);
    const client = await mcpClient(key);
    const res = await callTool(client, "read_note", { path: "secret/a.md" });
    expect(res.isError).toBeTruthy();
    await client.close();
  });

  test("get_backlinks hides contexts from a denied source note", async () => {
    await handle.vault.writeNote("secret/linker.md", "See [[public/b]] for more.\n");
    await handle.index.updatePath("secret/linker.md");

    const key = await createApiKey(ownerToken);
    const client = await mcpClient(key);
    const res = await callTool(client, "get_backlinks", { path: "public/b.md" });
    expect(JSON.stringify(res.content)).not.toContain("secret/linker.md");
    await client.close();
  });

  test("append_note on a write-only folder returns metadata only, not the body", async () => {
    await handle.vault.writeNote("writeonly/note.md", "top secret pre-existing content\n");
    await handle.index.updatePath("writeonly/note.md");
    await denyRead(ownerToken, "writeonly");

    const key = await createApiKey(ownerToken);
    const client = await mcpClient(key);
    const res = await callTool(client, "append_note", {
      path: "writeonly/note.md",
      content: "new line",
    });
    const text = JSON.stringify(res.content);
    expect(text).not.toContain("top secret pre-existing content");
    expect(text).toContain("writeonly/note.md");
    await client.close();
  });
});

describe("MCP OAuth scope enforcement — read-only token cannot mutate", () => {
  beforeEach(async () => {
    await setPassword("hunter2hunter2");
    await handle.authStore.load();
    await handle.vault.writeNote("public/b.md", "existing body\n");
    await handle.index.updatePath("public/b.md");
  });

  test("vault:read-only access token can read but not write_note/append_note", async () => {
    const pair = handle.oauthStore.issueTokenPair({
      clientId: "test-client",
      scope: "vault:read",
      resource: "http://localhost/mcp",
    });
    const client = await mcpClient(pair.accessToken);

    const read = await callTool(client, "read_note", { path: "public/b.md" });
    expect(read.isError).toBeFalsy();

    const write = await callTool(client, "write_note", { path: "public/b.md", content: "x" });
    expect(write.isError).toBeTruthy();

    const append = await callTool(client, "append_note", { path: "public/b.md", content: "x" });
    expect(append.isError).toBeTruthy();

    await client.close();
  });

  test("vault:read+write access token can write_note", async () => {
    const pair = handle.oauthStore.issueTokenPair({
      clientId: "test-client",
      scope: "vault:read vault:write",
      resource: "http://localhost/mcp",
    });
    const client = await mcpClient(pair.accessToken);
    const write = await callTool(client, "write_note", { path: "public/b.md", content: "x" });
    expect(write.isError).toBeFalsy();
    await client.close();
  });
});
