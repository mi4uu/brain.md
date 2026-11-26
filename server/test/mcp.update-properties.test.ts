import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp, type AppHandle } from "../src/app";

let h!: AppHandle;
let dir!: string;
let client!: Client;

async function connect(bearer?: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      h.app.handle(new Request(input, init))) as unknown as typeof fetch,
    requestInit: bearer ? { headers: { authorization: `Bearer ${bearer}` } } : {},
  });
  const c = new Client({ name: "test", version: "0.0.0" });
  await c.connect(transport);
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown>) {
  const r = await c.callTool({ name, arguments: args });
  return { isError: !!r.isError, body: JSON.parse((r.content as Array<{ text: string }>)[0]!.text) };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-props-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  await h.vault.writeNote("plan.md", "---\n# keep\nstatus: todo\ntags: [a]\n---\n\n# Plan\n");
  await h.vault.writeNote("plain.md", "# plain\n");
  await h.vault.writeNote("bad.md", "---\na: [1\n---\n");
  client = await connect();
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("read_note properties", () => {
  test("returns the parsed mapping next to content and revision", async () => {
    const r = await call(client, "read_note", { path: "plan.md" });
    expect(r.body.properties).toEqual({ status: "todo", tags: ["a"] });
    expect(r.body.content).toContain("# Plan");
    expect(r.body.revision).toMatch(/^[0-9a-f]{64}$/);
  });

  test("null without frontmatter and for invalid YAML", async () => {
    expect((await call(client, "read_note", { path: "plain.md" })).body.properties).toBeNull();
    expect((await call(client, "read_note", { path: "bad.md" })).body.properties).toBeNull();
  });
});

describe("update_properties", () => {
  test("is listed as a model-only write tool with annotations", async () => {
    const { tools } = await client.listTools();
    const t = tools.find((x) => x.name === "update_properties")!;
    expect(t.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: true, openWorldHint: false });
    expect(t._meta?.ui).toEqual({ visibility: ["model"] });
  });

  test("sets and unsets, leaving comments and other lines alone", async () => {
    const r = await call(client, "update_properties", { path: "plan.md", set: { status: "done", prio: 2 }, unset: ["tags"] });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ ok: true, path: "plan.md" });
    expect(await readFile(join(dir, "plan.md"), "utf8")).toBe("---\n# keep\nstatus: done\nprio: 2\n---\n\n# Plan\n");
  });

  test("base_revision: the revision from read_note works once, then a stale one is CONFLICT", async () => {
    const rev = (await call(client, "read_note", { path: "plan.md" })).body.revision as string;
    const ok = await call(client, "update_properties", { path: "plan.md", set: { status: "a" }, base_revision: rev });
    expect(ok.isError).toBe(false);
    const stale = await call(client, "update_properties", { path: "plan.md", set: { status: "b" }, base_revision: rev });
    expect(stale.isError).toBe(true);
    expect(stale.body.code).toBe("CONFLICT");
    expect(stale.body.current_revision).toBe(ok.body.revision);
  });

  test("errors carry a code: INVALID_YAML, NOT_FOUND, nothing to do", async () => {
    expect((await call(client, "update_properties", { path: "bad.md", set: { a: 1 } })).body.code).toBe("INVALID_YAML");
    expect((await call(client, "update_properties", { path: "nope.md", set: { a: 1 } })).body.code).toBe("NOT_FOUND");
    expect((await call(client, "update_properties", { path: "plan.md" })).body.code).toBe("INVALID_VALUE");
  });
});

describe("update_properties permissions", () => {
  test("an API key is held to folder permissions; a write-only folder gets no revision back", async () => {
    await h.vault.writeNote("secret/s.md", "---\nk: v\n---\n");
    await h.vault.writeNote("dropbox/d.md", "---\nk: v\n---\n");
    const login = await h.app.handle(new Request("http://localhost/api/auth/set", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ newPassword: "hunter2hunter2" }) }));
    expect(login.status).toBe(200);
    await h.authStore.load();
    const post = async (path: string, body: unknown, bearer?: string) => {
      const r = await h.app.handle(new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: JSON.stringify(body) }));
      return r.json() as Promise<any>;
    };
    const owner = (await post("/api/auth/login", { password: "hunter2hunter2" })).token as string;
    const key = (await post("/api/auth/keys", { name: "agent" }, owner)).token as string;
    await post("/api/folder-mcp-perms", { path: "secret", read: false, write: false }, owner);
    await post("/api/folder-mcp-perms", { path: "dropbox", read: false, write: true }, owner);

    const agent = await connect(key);
    const denied = await call(agent, "update_properties", { path: "secret/s.md", set: { a: 1 } });
    expect(denied.isError).toBe(true);
    expect(denied.body.code).toBe("MCP_WRITE_DENIED");
    const blind = await call(agent, "update_properties", { path: "dropbox/d.md", set: { a: 1 } });
    expect(blind.isError).toBe(false);
    expect(blind.body.revision).toBeUndefined();
    const guarded = await call(agent, "update_properties", { path: "dropbox/d.md", set: { a: 2 }, base_revision: "x" });
    expect(guarded.body.code).toBe("MCP_READ_DENIED");
    await agent.close();
  });
});
