import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/vault/vault";
import { VaultError } from "../src/vault/types";

// Regression for Codex r2 #3: a symlink inside the vault used to let a
// caller read through an alias into content the real (authorised) path
// would deny — `public/link -> secret` resolved to the same real file as
// `secret`, and the direct path's permission check never saw the alias.
// The fix rejects any symlink anywhere on the path, unconditionally.

let dir!: string;
let vault!: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-symlink-"));
  vault = new Vault(dir);
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("symlinks inside the vault", () => {
  test("reading through a symlinked directory is refused", async () => {
    await mkdir(join(dir, "secret"), { recursive: true });
    await writeFile(join(dir, "secret", "a.md"), "top secret\n");
    await symlink(join(dir, "secret"), join(dir, "public-link"));

    await expect(vault.readNote("public-link/a.md")).rejects.toThrow(VaultError);
    // The real path, with no alias involved, still works.
    const real = await vault.readNote("secret/a.md");
    expect(real.content).toBe("top secret\n");
  });

  test("a symlinked file itself is refused", async () => {
    await writeFile(join(dir, "real.md"), "content\n");
    await symlink(join(dir, "real.md"), join(dir, "alias.md"));
    await expect(vault.readNote("alias.md")).rejects.toThrow(VaultError);
  });

  test("writing to a path that does not exist yet is unaffected", async () => {
    const r = await vault.writeNote("fresh/new.md", "hello\n");
    expect(r.content).toBe("hello\n");
  });
});
