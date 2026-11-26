import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let h: AppHandle;
let dir: string;
let client: Client;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-page-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  for (let i = 0; i < 130; i++) {
    const n = String(i).padStart(3, "0");
    await h.vault.writeNoteChecked(`work/n${n}.md`, `# Note ${n}\n\n- [ ] task ${n}\n\nalpha keyword #t${i % 7}\n\nsee [[hub]]\n`);
  }
  await h.vault.writeNoteChecked("workshop/w.md", "# W\n\nalpha keyword\n");
  await h.vault.writeNoteChecked("hub.md", "# Hub\n");
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      h.app.handle(new Request(input, init))) as unknown as typeof fetch,
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>): Promise<{ body: unknown; note: string | null }> {
  const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }> };
  return { body: JSON.parse(r.content[0]!.text), note: r.content[1]?.text ?? null };
}

describe("MCP list tools page their results", () => {
  test("list_notes: 100 by default, next_offset and a hint, folders on the first page only", async () => {
    const first = await call("list_notes", {});
    const b1 = first.body as { notes: string[]; folders: string[]; total_notes: number; next_offset: number | null };
    expect(b1.notes.length).toBe(100);
    expect(b1.total_notes).toBe(132);
    expect(b1.next_offset).toBe(100);
    expect(b1.folders).toContain("work");
    expect(first.note).toContain("offset=100");

    const second = await call("list_notes", { offset: 100 });
    const b2 = second.body as { notes: string[]; folders: string[]; next_offset: number | null };
    expect(b2.notes.length).toBe(32);
    expect(b2.next_offset).toBeNull();
    expect(b2.folders).toEqual([]);
    expect(second.note).toBeNull();
    expect(new Set([...b1.notes, ...b2.notes]).size).toBe(132);
  });

  test("list_notes folder means that folder, not every path with the same prefix", async () => {
    const r = await call("list_notes", { folder: "work", limit: 1000 });
    const b = r.body as { notes: string[] };
    expect(b.notes.length).toBe(130);
    expect(b.notes.some((n) => n.startsWith("workshop/"))).toBe(false);
  });

  test("search_notes, get_tasks, get_backlinks and list_tags respect limit and offset", async () => {
    const s = await call("search_notes", { query: "keyword" });
    expect((s.body as unknown[]).length).toBe(20);
    expect(s.note).toContain("offset=20");

    const t = await call("get_tasks", { filter: "open", limit: 10, offset: 125 });
    expect((t.body as unknown[]).length).toBe(5);
    expect(t.note).toBeNull();

    const bl = await call("get_backlinks", { path: "hub.md" });
    expect((bl.body as unknown[]).length).toBe(50);
    expect(bl.note).toContain("offset=50");

    const tags = await call("list_tags", { limit: 3 });
    const tb = tags.body as Array<{ tag: string; count: number }>;
    expect(tb.length).toBe(3);
    expect(tb[0]!.count).toBeGreaterThanOrEqual(tb[1]!.count);
    expect(tags.note).toContain("offset=3");
  });

  test("limit above the maximum is rejected", async () => {
    const r = (await client.callTool({ name: "list_notes", arguments: { limit: 5000 } })) as { isError?: boolean };
    expect(r.isError).toBe(true);
  });
});
