import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Vault } from "../src/vault/vault";
import { APIKeyStore } from "../src/auth/api-keys";
import { LOCAL_SUB } from "../src/auth/identity";

let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-apikeys-sub-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("APIKeyStore: sub plumbing", () => {
  test("a newly created key gets its own stable subject", () => {
    const s = new APIKeyStore();
    const k1 = s.create({ name: "bot-1" });
    const k2 = s.create({ name: "bot-2" });
    expect(k1.sub).toBe(`apikey:${k1.id}`);
    expect(k2.sub).toBe(`apikey:${k2.id}`);
    expect(k1.sub).not.toBe(k2.sub);
  });

  test("validate() returns the same sub the key was created with", () => {
    const s = new APIKeyStore();
    const created = s.create({ name: "bot" });
    const rec = s.validate(created.token);
    expect(rec?.sub).toBe(created.sub);
  });

  test("old-format fixture (no sub field) migrates in place to local", async () => {
    const token = "old-key-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const fixture = {
      version: 1,
      keys: [
        {
          id: "aaaaaaaa",
          tokenHash: hashToken(token),
          prefix: token.slice(0, 8),
          name: "legacy key",
          createdAt: Date.now(),
          lastUsedAt: null,
          expiresAt: null,
        },
      ],
    };
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain", "api-keys.json"), JSON.stringify(fixture));

    const vault = new Vault(dir);
    const s = new APIKeyStore();
    await s.bindVault(vault);

    const rec = s.validate(token);
    expect(rec?.sub).toBe(LOCAL_SUB);

    await new Promise((r) => setTimeout(r, 250));
    const raw = JSON.parse(await readFile(join(dir, ".brain", "api-keys.json"), "utf8"));
    expect(raw.keys[0].sub).toBe(LOCAL_SUB);
  });

  test("old pre-hash fixture (plaintext token field) migrates to a hashed record with sub local", async () => {
    const token = "legacy-plaintext-api-key-value";
    const fixture = {
      version: 1,
      keys: [
        { id: "bbbbbbbb", token, name: "legacy key", createdAt: Date.now(), lastUsedAt: null, expiresAt: null },
      ],
    };
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain", "api-keys.json"), JSON.stringify(fixture));

    const vault = new Vault(dir);
    const s = new APIKeyStore();
    await s.bindVault(vault);

    const rec = s.validate(token);
    expect(rec?.sub).toBe(LOCAL_SUB);
  });
});
