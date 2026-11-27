import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Vault } from "../src/vault/vault";
import { VaultIndex } from "../src/index/index";

let dir!: string;
let vault!: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-idx-rev-"));
  vault = new Vault(dir);
  await vault.ensureRoot();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("IndexEntry.revision", () => {
  test("is the revision readNote reports and follows a rewrite", async () => {
    await vault.writeNote("a.md", "one");
    const idx = new VaultIndex(vault);
    await idx.buildAll();
    const first = idx.get("a.md")?.revision;
    expect(first).toBe((await vault.readNote("a.md")).revision);

    await vault.writeNote("a.md", "two");
    await idx.updatePath("a.md");
    expect(idx.get("a.md")?.revision).toBe((await vault.readNote("a.md")).revision);
    expect(idx.get("a.md")?.revision).not.toBe(first);
  });

  test("a version 3 snapshot is discarded and rebuilt, so entries gain a revision", async () => {
    await vault.writeNote("a.md", "one");
    const abs = vault.abs(".brain/index.json");
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, JSON.stringify({ version: 3, entries: { "a.md": { path: "a.md" } } }));
    const idx = new VaultIndex(vault);
    await idx.loadOrBuild();
    expect(idx.get("a.md")?.revision).toBe((await vault.readNote("a.md")).revision);
  });
});
