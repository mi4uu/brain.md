import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { DEFAULT_MCP_INSTRUCTIONS } from "../src/mcp/instructions";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let h: AppHandle;
let dir: string;
let client: Client;

const BOARD =
  "# Board\n\n```base\nviews:\n  - type: table\n    name: All\n    order: [file.name, n]\n```\n\n" +
  "```base\nfilters: status == \"Done\"\nviews:\n  - type: kanban\n    name: Finished\n    order: [file.name, status]\n    groupBy:\n      property: status\n```\n";

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-query-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  for (let i = 0; i < 60; i++) {
    const n = String(i).padStart(2, "0");
    await h.vault.writeNote(`work/n${n}.md`, `---\nn: ${i}\nstatus: ${i % 2 === 0 ? "Done" : "Todo"}\n---\n# N ${n}\n`);
  }
  await h.vault.writeNote("work/Board.md", BOARD);
  await h.vault.writeNote("work/plain.md", "# Plain\n");
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      h.app.handle(new Request(input, init))) as unknown as typeof fetch,
  });
  client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
});

afterEach(async () => {
  await client.close();
  h.autocommit.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function call(args: Record<string, unknown>) {
  const r = (await client.callTool({ name: "query_notes", arguments: args })) as {
    isError?: boolean;
    content: Array<{ text: string }>;
  };
  return { isError: r.isError === true, body: JSON.parse(r.content[0]!.text), note: r.content[1]?.text ?? null };
}

describe("query_notes", () => {
  test("simple form: filter, columns and sort", async () => {
    const r = await call({ filter: 'status == "Done" && n > 55', columns: ["file.name", "n"], sort: [{ property: "n", direction: "DESC" }] });
    expect(r.isError).toBe(false);
    expect(r.body.rows.map((x: { path: string }) => x.path)).toEqual(["work/n58.md", "work/n56.md"]);
    expect(r.body.rows[0].values).toEqual({ "file.name": "n58.md", n: 58 });
    expect(r.body.columns.map((c: { key: string }) => c.key)).toEqual(["file.name", "n"]);
  });

  test("pages 50 rows at a time with a hint for the next page", async () => {
    const first = await call({});
    expect(first.body.rows).toHaveLength(50);
    expect(first.body.total).toBe(62);
    expect(first.note).toContain("offset=50");
    const second = await call({ offset: 50 });
    expect(second.body.rows).toHaveLength(12);
    expect(second.note).toBeNull();
  });

  test("base form, with groups", async () => {
    const r = await call({ base: "filters: file.inFolder(\"work\")\nviews:\n  - type: table\n    name: G\n    groupBy:\n      property: status\n    order: [file.name]\n", limit: 5 });
    expect(r.body.rows.every((x: { group?: string }) => x.group === "Done")).toBe(true);
  });

  test("path form picks the fence that holds the named view, and `this` is that note", async () => {
    const r = await call({ path: "work/Board.md", view: "Finished" });
    expect(r.body.view).toBe("Finished");
    expect(r.body.total).toBe(30);
    expect(r.body.rows.map((x: { path: string }) => x.path)).not.toContain("work/Board.md");
    const first = await call({ path: "work/Board.md" });
    expect(first.body.view).toBe("All");
  });

  test("argument mistakes are errors with a code; engine problems are warnings", async () => {
    const both = await call({ base: "views: []", path: "work/Board.md" });
    expect(both.isError).toBe(true);
    expect(both.body.code).toBe("INVALID_ARGUMENT");
    expect((await call({ path: "work/Board.base" })).body.code).toBe("INVALID_ARGUMENT");
    expect((await call({ path: "work/plain.md" })).body.code).toBe("NO_BASE_BLOCK");
    const warn = await call({ filter: "sum(n) > 1" });
    expect(warn.isError).toBe(false);
    expect(warn.body.rows).toEqual([]);
    expect(warn.body.warnings).toEqual(['unsupported function "sum"']);
  });

  test("the agent instructions mention the tool", () => {
    expect(DEFAULT_MCP_INSTRUCTIONS).toContain("query_notes");
  });
});
