import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-resolve-"));
  h = createApp({ vaultDir: dir });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, content: string) {
  return h.app.handle(
    new Request(`http://localhost${path}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
  );
}

describe("resolve API (V4)", () => {
  test("resolves by basename across folders", async () => {
    await put("/api/note/sub/MyNote.md", "x");
    const res = await h.app.handle(
      new Request("http://localhost/api/resolve?name=MyNote"),
    );
    const body = (await res.json()) as { path: string | null };
    expect(body.path).toBe("sub/MyNote.md");
  });

  test("case-insensitive", async () => {
    await put("/api/note/Foo.md", "x");
    const res = await h.app.handle(
      new Request("http://localhost/api/resolve?name=foo"),
    );
    const body = (await res.json()) as { path: string | null };
    expect(body.path).toBe("Foo.md");
  });

  test("ambiguous returns multiple matches", async () => {
    await put("/api/note/a/Same.md", "x");
    await put("/api/note/b/Same.md", "y");
    const res = await h.app.handle(
      new Request("http://localhost/api/resolve?name=Same"),
    );
    const body = (await res.json()) as { matches: string[]; ambiguous: boolean };
    expect(body.matches.length).toBe(2);
    expect(body.ambiguous).toBe(true);
  });

  test("missing → path null", async () => {
    const res = await h.app.handle(
      new Request("http://localhost/api/resolve?name=Nope"),
    );
    const body = (await res.json()) as { path: string | null };
    expect(body.path).toBeNull();
  });
});
