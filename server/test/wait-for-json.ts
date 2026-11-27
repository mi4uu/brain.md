import { readFile } from "node:fs/promises";

// Stores flush on a debounce, so a fixed sleep races a slow CI runner.
// A missing file means "not flushed yet"; a file that does not parse is a
// real failure and throws at once, so polling never hides a torn write.
export async function waitForJson<T = any>(
  path: string,
  ready: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  for (;;) {
    let raw: string | undefined;
    try {
      raw = await readFile(path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (raw !== undefined) {
      last = JSON.parse(raw) as T;
      if (ready(last)) return last;
    }
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${path}; last value: ${JSON.stringify(last)}`);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}
