import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

// Regression for Codex r2 #4: destructive REST ops (folder delete, rename)
// must respect per-folder MCP permissions for agent credentials.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-destructive-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

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

async function setPassword(password: string): Promise<string> {
  await call("POST", "/api/auth/set", { newPassword: password });
  const r = await call("POST", "/api/auth/login", { password });
  return r.json.token;
}

async function createApiKey(ownerToken: string): Promise<string> {
  const r = await call("POST", "/api/auth/keys", { name: "agent" }, ownerToken);
  return r.json.token;
}

describe("DELETE /api/folder/* checks subtree permissions", () => {
  let ownerToken!: string;
  let apiKey!: string;

  beforeEach(async () => {
    ownerToken = await setPassword("hunter2hunter2");
    apiKey = await createApiKey(ownerToken);
    await handle.vault.writeNote("project/public.md", "visible\n");
    await handle.vault.writeNote("project/secret/a.md", "hidden\n");
    await call(
      "POST",
      "/api/folder-mcp-perms",
      { path: "project/secret", read: true, write: false },
      ownerToken,
    );
  });

  test("API key cannot delete a folder with a write-denied subfolder", async () => {
    const r = await call("DELETE", "/api/folder/project", undefined, apiKey);
    expect(r.status).toBe(403);
    // Nothing was deleted.
    expect((await handle.vault.stat("project/secret/a.md")).exists).toBe(true);
  });

  test("owner session can still delete the whole subtree", async () => {
    const r = await call("DELETE", "/api/folder/project", undefined, ownerToken);
    expect(r.status).toBe(200);
  });

  test("API key can delete a folder with no write-denied descendants", async () => {
    await handle.vault.writeNote("open-folder/x.md", "fine\n");
    const r = await call("DELETE", "/api/folder/open-folder", undefined, apiKey);
    expect(r.status).toBe(200);
  });
});

describe("POST /api/rename refuses to rewrite links it cannot write", () => {
  let ownerToken!: string;
  let apiKey!: string;

  beforeEach(async () => {
    ownerToken = await setPassword("hunter2hunter2");
    apiKey = await createApiKey(ownerToken);
    await handle.vault.writeNote("public/old-name.md", "# Old Name\n");
    await handle.vault.writeNote("secret/linker.md", "See [[public/old-name]] for context.\n");
    await handle.index.updatePath("public/old-name.md");
    await handle.index.updatePath("secret/linker.md");
    await call(
      "POST",
      "/api/folder-mcp-perms",
      { path: "secret", read: true, write: false },
      ownerToken,
    );
  });

  test("API key rename is refused with 403, nothing is renamed or patched", async () => {
    const r = await call(
      "POST",
      "/api/rename",
      { from: "public/old-name.md", to: "public/new-name.md" },
      apiKey,
    );
    expect(r.status).toBe(403);
    expect((await handle.vault.stat("public/old-name.md")).exists).toBe(true);
    const linker = await handle.vault.readNote("secret/linker.md");
    expect(linker.content).toContain("[[public/old-name]]");
  });

  test("owner session can rename and the denied-folder link still gets patched", async () => {
    const r = await call(
      "POST",
      "/api/rename",
      { from: "public/old-name.md", to: "public/new-name.md" },
      ownerToken,
    );
    expect(r.status).toBe(200);
    const linker = await handle.vault.readNote("secret/linker.md");
    expect(linker.content).toContain("[[public/new-name]]");
  });
});

describe("rename rewrites .md-suffixed wikilinks (Codex r2 #19)", () => {
  test("[[work/A.md]] is rewritten on move", async () => {
    await handle.vault.writeNote("work/A.md", "# A\n");
    await handle.vault.writeNote("linker.md", "See [[work/A.md]] for details.\n");
    await handle.index.updatePath("work/A.md");
    await handle.index.updatePath("linker.md");

    const r = await call("POST", "/api/rename", { from: "work/A.md", to: "archive/B.md" });
    expect(r.status).toBe(200);
    const linker = await handle.vault.readNote("linker.md");
    expect(linker.content).toContain("[[archive/B]]");
    expect(linker.content).not.toContain("work/A.md");
  });
});
