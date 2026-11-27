import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";

let h!: AppHandle;
let dir!: string;

const TABLE =
  "views:\n  - type: table\n    name: T\n    order: [file.name, status, n, owner]\n    sort:\n      - property: n\n        direction: ASC\n";

async function call(method: string, path: string, body?: unknown, bearer?: string) {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await h.app.handle(new Request(`http://localhost${path}`, init));
  return { status: r.status, json: parseBody(await r.text()) };
}

// JSON.parse returns any, which keeps the assertions below short.
function parseBody(text: string) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

const query = (body: unknown, bearer?: string) => call("POST", "/api/bases/query", body, bearer);
const rowPaths = (r: { json: unknown }) => (r.json as BaseQueryResponse).groups.flatMap((g) => g.rows.map((x) => x.path));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-api-bases-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
  await h.vault.writeNote("work/A.md", '---\nstatus: Todo\nn: 2\nowner: "[[secret/S]]"\n---\n# A\n');
  await h.vault.writeNote("work/B.md", "---\nstatus: Doing\nn: 10\n---\n# B\n");
  await h.vault.writeNote("work/C.md", "---\nstatus: Done\nn: 5\nhidden: true\n---\n# C\n");
  await h.vault.writeNote("secret/S.md", "---\nstatus: Todo\nn: 1\n---\n# S\n");
  await h.vault.writeNote("work/View.md", "# View\n");
});

afterEach(async () => {
  h.autocommit.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function lockDown() {
  await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
  await h.authStore.load();
  const login = await call("POST", "/api/auth/login", { password: "hunter2hunter2" });
  const owner = login.json.token as string;
  const key = await call("POST", "/api/auth/keys", { name: "agent" }, owner);
  await call("POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: false }, owner);
  return { owner, apiKey: key.json.token as string };
}

describe("POST /api/bases/query", () => {
  test("rows come sorted, with values, types and the revision a PATCH needs", async () => {
    const r = await query({ source: TABLE, thisPath: "work/View.md" });
    expect(r.status).toBe(200);
    expect(rowPaths(r)).toEqual(["secret/S.md", "work/A.md", "work/B.md"]);
    expect(r.json.columns.map((c: { key: string; type: string }) => [c.key, c.type])).toEqual([
      ["file.name", "file"],
      ["status", "text"],
      ["n", "number"],
      ["owner", "text"],
    ]);
    const a = r.json.groups[0].rows.find((x: { path: string }) => x.path === "work/A.md");
    expect(a.values).toMatchObject({ "file.name": "A.md", status: "Todo", n: 2 });
    expect(a.revision).toBe((await h.vault.readNote("work/A.md")).revision);
  });

  test("offset and limit page the rows; total stays whole", async () => {
    const r = await query({ source: TABLE, thisPath: "work/View.md", offset: 1, limit: 1 });
    expect(rowPaths(r)).toEqual(["work/A.md"]);
    expect(r.json.total).toBe(3);
  });

  test("a hidden note is left out", async () => {
    expect(rowPaths(await query({ source: TABLE }))).not.toContain("work/C.md");
  });

  test("unsupported syntax is a warning, not an error", async () => {
    const r = await query({ source: "filters: sum(n) > 1\n" });
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(0);
    expect(r.json.warnings).toEqual(['unsupported function "sum"']);
  });

  test("YAML that does not parse is a 200 with a warning; a body without source is 422", async () => {
    const bad = await query({ source: "views: [" });
    expect(bad.status).toBe(200);
    expect(bad.json.groups).toEqual([]);
    expect(bad.json.warnings[0]).toStartWith("YAML:");
    expect((await call("POST", "/api/bases/query", {})).status).toBe(422);
  });

  test("a source over 100000 characters is a 422", async () => {
    expect((await query({ source: "x".repeat(100_001) })).status).toBe(422);
  });

  test("a folder the caller cannot read: rows, link cells and `this` are all closed", async () => {
    const { apiKey } = await lockDown();
    const r = await query({ source: TABLE, thisPath: "work/View.md" }, apiKey);
    expect(r.status).toBe(200);
    expect(rowPaths(r)).toEqual(["work/A.md", "work/B.md"]);
    expect(JSON.stringify(r.json)).not.toContain("secret/S");
    const a = r.json.groups[0].rows.find((x: { path: string }) => x.path === "work/A.md");
    expect(a.values.owner).toBeNull();

    const sneaky = await query({ source: 'filters: this.status == "Todo"\n', thisPath: "secret/S.md" }, apiKey);
    expect(sneaky.json.total).toBe(0);
    expect(sneaky.json.warnings).toContain("the note holding this view is not readable; `this` was left empty");
  });
});
