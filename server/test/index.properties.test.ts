import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { VaultIndex } from "../src/index/index";

let h: AppHandle;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-props-"));
  h = createApp({ vaultDir: dir, gitAutocommit: false });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(path: string, content: string) {
  await h.vault.writeNote(path, content);
  await h.index.updatePath(path);
}

describe("index keeps frontmatter properties", () => {
  test("props hold the whole mapping, JSON-safe, and ctime is set", async () => {
    await put("a.md", "---\nstatus: todo\ncount: 3\ndone: false\ndue: 2026-12-01\ntags: [x, y]\nnested:\n  k: 1\nempty:\n---\n# A\n");
    const e = h.index.get("a.md")!;
    expect(e.props).toEqual({
      status: "todo",
      count: 3,
      done: false,
      due: "2026-12-01",
      tags: ["x", "y"],
      nested: { k: 1 },
      empty: null,
    });
    expect(e.ctime).toBeGreaterThan(0);
  });

  test("a note without frontmatter, or with invalid frontmatter, has empty props", async () => {
    await put("plain.md", "# plain\n");
    await put("bad.md", "---\na: [1\n---\nbody\n");
    expect(h.index.get("plain.md")!.props).toEqual({});
    expect(h.index.get("bad.md")!.props).toEqual({});
  });

  test("a leading BOM does not hide the frontmatter", async () => {
    await put("bom.md", "﻿---\nstatus: ok\n---\nbody\n");
    expect(h.index.get("bom.md")!.props).toEqual({ status: "ok" });
  });

  test("a __proto__ key never reaches props", async () => {
    await put("p.md", "---\na: 1\n__proto__: x\n---\n");
    expect(Object.keys(h.index.get("p.md")!.props)).toEqual(["a"]);
  });

  test("rename keeps props", async () => {
    await put("old.md", "---\na: 1\n---\n");
    h.index.rename("old.md", "new.md");
    expect(h.index.get("new.md")!.props).toEqual({ a: 1 });
  });
});

describe("propertyKeys", () => {
  beforeEach(async () => {
    await put("a.md", "---\nstatus: todo\nprio: 1\ntags: [x, y]\ndue: 2026-12-01\n---\n");
    await put("b.md", "---\nstatus: todo\nprio: 2\ntags: [x]\ndone: true\n---\n");
    await put("c.md", "---\nstatus: done\ndue: 2026-12-02T10:00\n---\n");
    await put("secret/d.md", "---\nstatus: hidden-value\nonly_secret: 1\n---\n");
  });

  test("counts, inferred types, most used first, values by frequency", async () => {
    const infos = h.index.propertyKeys();
    const byName = Object.fromEntries(infos.map((i) => [i.name, i]));
    expect(infos[0]!.name).toBe("status");
    expect(byName.status).toMatchObject({ count: 4, type: "text" });
    expect(byName.status!.values.slice(0, 2)).toEqual(["todo", "done"]);
    expect(byName.prio).toMatchObject({ count: 2, type: "number" });
    expect(byName.tags).toMatchObject({ count: 2, type: "tags", values: ["x", "y"] });
    expect(byName.due).toMatchObject({ count: 2, type: "datetime" });
    expect(byName.done).toMatchObject({ count: 1, type: "checkbox", values: [true] });
  });

  test("the read filter drops notes, so their keys and values disappear", async () => {
    const infos = h.index.propertyKeys((p) => !p.startsWith("secret/"));
    expect(infos.some((i) => i.name === "only_secret")).toBe(false);
    expect(infos.find((i) => i.name === "status")!.values).not.toContain("hidden-value");
  });

  test("values are capped at 20", async () => {
    for (let i = 0; i < 30; i++) await put(`many/n${i}.md`, `---\nuniq: v${i}\n---\n`);
    expect(h.index.propertyKeys().find((i) => i.name === "uniq")!.values.length).toBe(20);
  });
});

describe("snapshot version", () => {
  test("an older snapshot is rebuilt instead of trusted", async () => {
    await h.vault.writeNote("a.md", "---\nstatus: todo\n---\n");
    await mkdir(join(dir, ".brain"), { recursive: true });
    await writeFile(join(dir, ".brain/index.json"), JSON.stringify({ version: 2, entries: {} }));
    const idx = new VaultIndex(h.vault);
    await idx.loadOrBuild();
    expect(idx.snapshot().version).toBe(4);
    expect(idx.get("a.md")!.props).toEqual({ status: "todo" });
  });
});
