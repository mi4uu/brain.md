import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { atomicWrite, atomicWriteBytes, tmpNameFor } from "../src/vault/atomic-write";

let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-atomic-write-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("tmpNameFor", () => {
  test("gives a different name on every call for the same destination", () => {
    const abs = join(dir, "store.json");
    const names = new Set(Array.from({ length: 50 }, () => tmpNameFor(abs)));
    expect(names.size).toBe(50);
  });
});

describe("atomicWrite: concurrent writes to the same destination", () => {
  test("every write lands whole, nothing interleaves, and no tmp file is left behind", async () => {
    const abs = join(dir, "store.json");
    const writes = Array.from({ length: 20 }, (_, i) => atomicWrite(abs, JSON.stringify({ i })));
    await Promise.all(writes);

    const final = JSON.parse(await readFile(abs, "utf8"));
    expect(typeof final.i).toBe("number");
    expect(final.i).toBeGreaterThanOrEqual(0);
    expect(final.i).toBeLessThan(20);

    const leftover = (await readdir(dir)).filter((n) => n.includes(".tmp-"));
    expect(leftover).toEqual([]);
  });
});

describe("atomicWrite: failure cleanup", () => {
  test("a write-step failure unlinks its own tmp file instead of leaking it", async () => {
    const abs = join(dir, "store.json");
    // Not a string: handle.writeFile rejects synchronously before any
    // rename, which is the failure mode that used to leave an orphaned
    // tmp-<pid>-<hex> file with no cleanup.
    const bad = { not: "a string" } as unknown as string;
    await expect(atomicWrite(abs, bad)).rejects.toThrow();

    const leftover = (await readdir(dir)).filter((n) => n.includes(".tmp-"));
    expect(leftover).toEqual([]);
  });

  test("a rename-step failure (destination is a directory) also unlinks the tmp file", async () => {
    const abs = join(dir, "store.json");
    await mkdir(abs); // abs exists as a directory, so rename(tmp, abs) fails

    await expect(atomicWrite(abs, "{}")).rejects.toThrow();

    const leftover = (await readdir(dir)).filter((n) => n.includes(".tmp-"));
    expect(leftover).toEqual([]);
  });

  test("atomicWriteBytes also cleans up its tmp file on a write-step failure", async () => {
    const abs = join(dir, "store.bin");
    const bad = { not: "bytes" } as unknown as Uint8Array;
    await expect(atomicWriteBytes(abs, bad)).rejects.toThrow();

    const leftover = (await readdir(dir)).filter((n) => n.includes(".tmp-"));
    expect(leftover).toEqual([]);
  });
});

describe("atomicWrite: does not clobber an unrelated in-flight write", () => {
  test("two destinations in the same directory never share a tmp name", async () => {
    const absA = join(dir, "a.json");
    const absB = join(dir, "b.json");
    await Promise.all([atomicWrite(absA, '{"who":"a"}'), atomicWrite(absB, '{"who":"b"}')]);
    expect(JSON.parse(await readFile(absA, "utf8")).who).toBe("a");
    expect(JSON.parse(await readFile(absB, "utf8")).who).toBe("b");
  });
});
