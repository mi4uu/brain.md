import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

// Regression for Codex r2 #2: /api/media-raw must never serve vault
// control files (.brain/settings.json, trash, …), only real media.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-media-control-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function get(path: string) {
  return handle.app.handle(new Request(`http://localhost${path}`));
}

describe("GET /api/media-raw rejects control paths", () => {
  test("refuses .brain/settings.json", async () => {
    const r = await get("/api/media-raw/.brain/settings.json");
    expect(r.status).toBe(403);
    const text = await r.text();
    expect(text).not.toContain("apiKey");
  });

  test("refuses a .brain/trash path", async () => {
    const r = await get("/api/media-raw/.brain/trash/20240101-000000/secret.md");
    expect(r.status).toBe(403);
  });

  test("refuses a .git path", async () => {
    const r = await get("/api/media-raw/.git/config");
    expect(r.status).toBe(403);
  });

  test("still serves a real media file under .media/", async () => {
    await handle.vault.writeNote("note.md", "body\n");
    await handle.vault.writeMedia("note.md", "photo.png", new Uint8Array([1, 2, 3]));
    const r = await get("/api/media-raw/.media/photo.png");
    expect(r.status).toBe(200);
  });
});
