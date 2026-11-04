import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";

describe("health", () => {
  test("GET /health → 200 ok", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brain-health-"));
    const { app } = createApp({ vaultDir: dir });
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("GET /health never leaks the vault's filesystem path, unauthenticated", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brain-health-"));
    const { app } = createApp({ vaultDir: dir });
    const res = await app.handle(new Request("http://localhost/health"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["ok"]);
    expect(JSON.stringify(body)).not.toContain(dir);
    await rm(dir, { recursive: true, force: true });
  });
});
