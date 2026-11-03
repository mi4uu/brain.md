import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Vault } from "../src/vault/vault";
import { TokenStore } from "../src/auth/tokens";
import { LOCAL_SUB } from "../src/auth/identity";

let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-tokens-sub-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

describe("TokenStore: sub plumbing", () => {
  test("issue() defaults sub to local; subFor() returns it", () => {
    const t = new TokenStore();
    const { token } = t.issue();
    expect(t.validate(token)).toBe(true);
    expect(t.subFor(token)).toBe(LOCAL_SUB);
  });

  test("issue(sub) stores the given subject", () => {
    const t = new TokenStore();
    const { token } = t.issue("local-2");
    expect(t.subFor(token)).toBe("local-2");
  });

  test("subFor() on an unknown or expired token returns undefined", () => {
    const t = new TokenStore();
    expect(t.subFor("nope")).toBeUndefined();
    expect(t.subFor(undefined)).toBeUndefined();
  });

  test("old-format fixture (no sub field) migrates in place to local", async () => {
    const token = "old-plaintext-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const fixture = {
      version: 1,
      tokens: [{ tokenHash: hashToken(token), expiresAt: Date.now() + 60_000 }],
    };
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain", "tokens.json"), JSON.stringify(fixture));

    const vault = new Vault(dir);
    const t = new TokenStore();
    await t.bindVault(vault);

    expect(t.validate(token)).toBe(true);
    expect(t.subFor(token)).toBe(LOCAL_SUB);

    // Migration rewrites the file with a sub on next flush (debounced).
    await new Promise((r) => setTimeout(r, 250));
    const raw = JSON.parse(await readFile(join(dir, ".brain", "tokens.json"), "utf8"));
    expect(raw.tokens[0].sub).toBe(LOCAL_SUB);
  });

  test("old pre-hash fixture (plaintext token field) migrates to a hashed record with sub", async () => {
    const token = "legacy-plaintext-token-value";
    const fixture = {
      version: 1,
      tokens: [{ token, expiresAt: Date.now() + 60_000 }],
    };
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain", "tokens.json"), JSON.stringify(fixture));

    const vault = new Vault(dir);
    const t = new TokenStore();
    await t.bindVault(vault);

    expect(t.validate(token)).toBe(true);
    expect(t.subFor(token)).toBe(LOCAL_SUB);
  });
});
