import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/vault/vault";
import { APIKeyStore } from "../src/auth/api-keys";

let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-apikeys-flush-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("APIKeyStore: concurrent flushes", () => {
  test("creating several keys back to back never corrupts api-keys.json and leaves no tmp file", async () => {
    const vault = new Vault(dir);
    const store = new APIKeyStore();
    await store.bindVault(vault);

    const created = Array.from({ length: 10 }, (_, i) => store.create({ name: `bot-${i}` }));

    // Each create() schedules a debounced flush; firing them back to back
    // used to race on a fixed, non-exclusive "<abs>.tmp" path.
    await new Promise((r) => setTimeout(r, 300));

    const abs = join(dir, ".brain", "api-keys.json");
    const raw = await readFile(abs, "utf8");
    const parsed = JSON.parse(raw); // throws if the file is half-written/corrupt
    expect(parsed.version).toBe(1);
    expect(parsed.keys.length).toBe(10);
    const ids = new Set(parsed.keys.map((k: { id: string }) => k.id));
    for (const k of created) expect(ids.has(k.id)).toBe(true);

    const leftover = (await readdir(join(dir, ".brain"))).filter((n) => n.includes(".tmp"));
    expect(leftover).toEqual([]);
  });

  test("revoking while a create flush is still pending still ends with a consistent file", async () => {
    const vault = new Vault(dir);
    const store = new APIKeyStore();
    await store.bindVault(vault);

    const k1 = store.create({ name: "keep" });
    const k2 = store.create({ name: "revoke-me" });
    // Fire the revoke immediately, before the debounced flush for the
    // creates above has run, so its own scheduleFlush() lands while the
    // first flush is still in flight.
    store.revoke(k2.id);

    await new Promise((r) => setTimeout(r, 300));

    const abs = join(dir, ".brain", "api-keys.json");
    const parsed = JSON.parse(await readFile(abs, "utf8"));
    expect(parsed.keys.length).toBe(1);
    expect(parsed.keys[0].id).toBe(k1.id);

    const leftover = (await readdir(join(dir, ".brain"))).filter((n) => n.includes(".tmp"));
    expect(leftover).toEqual([]);
  });
});
