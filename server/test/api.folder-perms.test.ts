import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import {
  resolveFolderPerms,
  DEFAULT_MCP_PERMS,
} from "../src/api/folder-perms";

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-fperms-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function call(m: string, p: string, b?: unknown) {
  const init: RequestInit = { method: m, headers: {} };
  if (b !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json";
    init.body = JSON.stringify(b);
  }
  const r = await handle.app.handle(new Request(`http://localhost${p}`, init));
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : null };
}

describe("resolveFolderPerms — V52", () => {
  test("empty map → default rw", () => {
    expect(resolveFolderPerms("a/b.md", {})).toEqual(DEFAULT_MCP_PERMS);
  });

  test("exact parent folder override wins", () => {
    expect(
      resolveFolderPerms("Daily/2024-01.md", {
        Daily: { read: true, write: false },
      }),
    ).toEqual({ read: true, write: false });
  });

  test("nearest ancestor override wins (Daily wins over root)", () => {
    expect(
      resolveFolderPerms("Daily/2024/01.md", {
        "": { read: false, write: false },
        Daily: { read: true, write: false },
      }),
    ).toEqual({ read: true, write: false });
  });

  test("root override applies when no closer rule", () => {
    expect(
      resolveFolderPerms("Unmapped/x.md", {
        "": { read: false, write: false },
      }),
    ).toEqual({ read: false, write: false });
  });

  test("deep path walks all ancestors", () => {
    expect(
      resolveFolderPerms("a/b/c/d.md", {
        "a/b": { read: true, write: false },
      }),
    ).toEqual({ read: true, write: false });
  });
});

describe("folder-perms HTTP — T118 / V52", () => {
  test("GET empty by default", async () => {
    const r = await call("GET", "/api/folder-mcp-perms");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({});
  });

  test("POST upserts; GET returns map", async () => {
    const p = await call("POST", "/api/folder-mcp-perms", {
      path: "Daily",
      read: true,
      write: false,
    });
    expect(p.status).toBe(200);
    expect(p.json.mcp.Daily).toEqual({ read: true, write: false });
    const g = await call("GET", "/api/folder-mcp-perms");
    expect(g.json.Daily).toEqual({ read: true, write: false });
  });

  test("POST re-upserts overrides previous values", async () => {
    await call("POST", "/api/folder-mcp-perms", {
      path: "x",
      read: false,
      write: false,
    });
    const r = await call("POST", "/api/folder-mcp-perms", {
      path: "x",
      read: true,
      write: true,
    });
    expect(r.json.mcp.x).toEqual({ read: true, write: true });
  });

  test("DELETE drops an override", async () => {
    await call("POST", "/api/folder-mcp-perms", {
      path: "Tags",
      read: true,
      write: false,
    });
    const d = await call("DELETE", "/api/folder-mcp-perms/Tags");
    expect(d.status).toBe(200);
    expect(d.json.mcp.Tags).toBeUndefined();
  });
});
