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
    const past = await call({ offset: 500 });
    expect(past.body.rows).toEqual([]);
    expect(past.body.total).toBe(62);
    expect(past.note).toBe("No more rows: there are 62 in total.");
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

  test("view with the simple form, and a view in no fence, are errors", async () => {
    const mixed = await call({ filter: "n > 1", view: "All" });
    expect(mixed.body.code).toBe("INVALID_ARGUMENT");
    const missing = await call({ path: "work/Board.md", view: "Nope" });
    expect(missing.isError).toBe(true);
    expect(missing.body.code).toBe("NOT_FOUND");
    const empty = (await client.callTool({ name: "query_notes", arguments: { base: "" } })) as { isError?: boolean };
    expect(empty.isError).toBe(true);
  });

  test("long cells are cut and counted in a warning", async () => {
    await h.vault.writeNote("work/long.md", `---\ndesc: ${"x".repeat(5000)}\n---\n# Long\n`);
    const r = await call({ filter: 'file.name == "long.md"', columns: ["desc"] });
    expect(r.body.rows[0].values.desc).toHaveLength(501);
    expect(r.body.rows[0].values.desc.endsWith("…")).toBe(true);
    expect(r.body.warnings).toContain("1 cell(s) longer than 500 characters were cut.");
  });

  test("a page stops at the reply budget and continues at the first omitted row", async () => {
    for (let i = 0; i < 150; i++) {
      await h.vault.writeNote(`big/b${String(i).padStart(3, "0")}.md`, `---\n${Array.from({ length: 10 }, (_, k) => `p${k}: ${"y".repeat(450)}`).join("\n")}\n---\n# B\n`);
    }
    const cols = Array.from({ length: 10 }, (_, k) => `p${k}`);
    const r = await call({ filter: 'file.inFolder("big")', columns: cols, limit: 200 });
    expect(r.body.rows.length).toBeLessThan(150);
    expect(JSON.stringify(r.body).length).toBeLessThan(220_000);
    expect(r.note).toContain(`offset=${r.body.rows.length}`);
    expect(r.body.warnings.some((w: string) => w.includes("shortened"))).toBe(true);
    const next = await call({ filter: 'file.inFolder("big")', columns: cols, limit: 200, offset: r.body.rows.length });
    expect(next.body.rows[0].path).toBe(`big/b${String(r.body.rows.length).padStart(3, "0")}.md`);
  });

  test("rows carry revision and partial; a cell cut here is listed in partial", async () => {
    await h.vault.writeNote("work/long.md", `---\ndesc: ${"x".repeat(5000)}\nrefs: ["${"t".repeat(600)}", b]\nn: 1\n---\n# Long\n`);
    const r = await call({ filter: 'file.name == "long.md"', columns: ["desc", "refs", "n"] });
    const row = r.body.rows[0];
    expect(row.revision).toBe((await h.vault.readNote("work/long.md")).revision);
    expect(row.partial).toEqual(["desc", "refs"]);
    const plain = await call({ filter: 'file.name == "n01.md"', columns: ["n"] });
    expect(plain.body.rows[0].partial).toBeUndefined();
    expect(plain.body.rows[0].revision).toBe((await h.vault.readNote("work/n01.md")).revision);
  });

  test("an engine cut and a cut here are listed once", async () => {
    await h.vault.writeNote("work/huge.md", `---\ndesc: ${"x".repeat(12_000)}\n---\n# Huge\n`);
    const r = await call({ filter: 'file.name == "huge.md"', columns: ["desc"] });
    expect(r.body.rows[0].partial).toEqual(["desc"]);
  });

  test("grouped rows carry the group key next to its label", async () => {
    await h.vault.writeNote("work/odd.md", "---\nstatus: No value\n---\n# Odd\n");
    await h.vault.writeNote("work/none.md", "# None\n");
    const base = 'filters: file.name == "odd.md" || file.name == "none.md"\nviews:\n  - type: table\n    name: G\n    groupBy:\n      property: status\n    order: [file.name]\n';
    const r = await call({ base });
    expect(r.body.rows.map((x: { path: string; group: string; group_key: string | null }) => [x.path, x.group, x.group_key])).toEqual([
      ["work/odd.md", "No value", "No value"],
      ["work/none.md", "No value", null],
    ]);
  });

  test("rows past the engine's response budget can still be paged", async () => {
    const cols = Array.from({ length: 50 }, (_, k) => `p${k}`);
    const body = cols.map((c) => `${c}: ${"z".repeat(5000)}`).join("\n");
    for (let i = 0; i < 30; i++) await h.vault.writeNote(`wide/w${String(i).padStart(2, "0")}.md`, `---\n${body}\n---\n# W\n`);
    const r = await call({ filter: 'file.inFolder("wide")', columns: cols, offset: 25, limit: 1 });
    expect(r.body.total).toBe(30);
    expect(r.body.rows.map((x: { path: string }) => x.path)).toEqual(["wide/w25.md"]);
  });
});
