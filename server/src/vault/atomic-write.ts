import { randomBytes } from "node:crypto";
import { open as fsOpen, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

// Shared write-then-rename helper for every JSON/text store in the server
// (vault notes, settings, auth store, folder perms, index, API keys). A
// fixed or millisecond-resolution tmp name collides whenever two writes to
// the same destination land close together: both open the same tmp path,
// so one write's content can be clobbered by the other's, and the renamer
// that lost the race gets ENOENT. A random suffix plus exclusive ("wx")
// creation makes each write's tmp file unique and guarantees nobody else
// can be holding it. The whole open/write/rename lifecycle runs under one
// try/finally so a tmp file that never made it into place (write failure,
// ENOSPC, …) is always unlinked rather than left orphaned.

export function tmpNameFor(abs: string): string {
  return `${abs}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
}

export interface AtomicWriteOptions {
  mode?: number;
}

async function writeExclusive(
  abs: string,
  write: (handle: FileHandle) => Promise<void>,
  options?: AtomicWriteOptions,
): Promise<void> {
  const tmp = tmpNameFor(abs);
  const handle = await fsOpen(tmp, "wx", options?.mode);
  try {
    try {
      await write(handle);
    } finally {
      await handle.close();
    }
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export async function atomicWrite(
  abs: string,
  content: string,
  options?: AtomicWriteOptions,
): Promise<void> {
  await writeExclusive(abs, (handle) => handle.writeFile(content, "utf8"), options);
}

export async function atomicWriteBytes(
  abs: string,
  bytes: Uint8Array,
  options?: AtomicWriteOptions,
): Promise<void> {
  await writeExclusive(abs, (handle) => handle.writeFile(bytes), options);
}
