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
    const body = (await res.json()) as { ok: boolean; vaultDir: string };
    expect(body.ok).toBe(true);
    expect(body.vaultDir).toBe(dir);
    await rm(dir, { recursive: true, force: true });
  });
});
