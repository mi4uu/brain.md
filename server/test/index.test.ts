import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/vault/vault";
import { VaultIndex } from "../src/index/index";
import { parseNote } from "../src/index/parse";

let dir: string;
let vault: Vault;
let idx: VaultIndex;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-idx-"));
  vault = new Vault(dir);
  await vault.ensureRoot();
  idx = new VaultIndex(vault);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseNote", () => {
  test("frontmatter title", () => {
    const p = parseNote("---\ntitle: My Title\ntag: x\n---\n# H1\n");
    expect(p.title).toBe("My Title");
    expect(p.frontmatter?.title).toBe("My Title");
  });

  test("fallback title from H1", () => {
    const p = parseNote("# Hello\nbody");
    expect(p.title).toBe("Hello");
  });

  test("wikilinks + aliased + embed", () => {
    const p = parseNote("see [[Foo]] and [[Bar|baz]]\n![[image.png]]");
    expect(p.links.map((l) => ({ t: l.target, a: l.alias, e: l.embed }))).toEqual([
      { t: "Foo", a: null, e: false },
      { t: "Bar", a: "baz", e: false },
      { t: "image.png", a: null, e: true },
    ]);
  });

  test("wikilinks ignored inside code fences", () => {
    const p = parseNote("```\n[[NotALink]]\n```\n[[RealLink]]");
    expect(p.links.length).toBe(1);
    expect(p.links[0]!.target).toBe("RealLink");
  });

  test("tags parsed; ignored inside code fences", () => {
    const p = parseNote("hello #foo and #bar/sub\n```\n#nope\n```\nend #foo");
    expect(p.tags).toEqual(["bar/sub", "foo"]);
  });

  test("headings + line numbers (body relative)", () => {
    const p = parseNote("# H1\n## H2\ntext\n### H3");
    expect(p.headings).toEqual([
      { level: 1, text: "H1", line: 1 },
      { level: 2, text: "H2", line: 2 },
      { level: 3, text: "H3", line: 4 },
    ]);
  });

  test("malformed frontmatter reports error, does not crash", () => {
    const p = parseNote("---\nbad: [\n---\nbody");
    expect(p.frontmatterError).toBeTruthy();
    expect(p.body).toBe("body");
  });

  test("strip section anchor from link target", () => {
    const p = parseNote("[[Note#Section]]");
    expect(p.links[0]!.target).toBe("Note");
  });
});

describe("VaultIndex", () => {
  test("buildAll indexes all notes", async () => {
    await vault.writeNote("a.md", "# A\n[[b]]");
    await vault.writeNote("sub/b.md", "# B\n#tag1");
    await idx.buildAll();
    const all = idx.entries();
    expect(all.length).toBe(2);
    expect(idx.get("a.md")?.title).toBe("A");
    expect(idx.get("sub/b.md")?.tags).toEqual(["tag1"]);
  });

  test("resolveByBasename case-insensitive", async () => {
    await vault.writeNote("Foo.md", "x");
    await vault.writeNote("sub/Bar.md", "y");
    await idx.buildAll();
    expect(idx.resolveByBasename("foo")).toEqual(["Foo.md"]);
    expect(idx.resolveByBasename("BAR")).toEqual(["sub/Bar.md"]);
    expect(idx.resolveByBasename("missing")).toEqual([]);
  });

  test("backlinks", async () => {
    await vault.writeNote("a.md", "links to [[B]]");
    await vault.writeNote("b.md", "no link");
    await idx.buildAll();
    const bl = idx.backlinks("b.md");
    expect(bl.length).toBe(1);
    expect(bl[0]!.from).toBe("a.md");
  });

  test("incremental updatePath replaces entry", async () => {
    await vault.writeNote("a.md", "v1");
    await idx.buildAll();
    expect(idx.get("a.md")?.title).toBe("a");
    await vault.writeNote("a.md", "# Hello v2");
    await idx.updatePath("a.md");
    expect(idx.get("a.md")?.title).toBe("Hello v2");
  });

  test("remove entry", async () => {
    await vault.writeNote("a.md", "x");
    await idx.buildAll();
    idx.remove("a.md");
    expect(idx.get("a.md")).toBeUndefined();
  });

  test("persist + load round-trip", async () => {
    await vault.writeNote("a.md", "# Hi");
    await idx.buildAll();
    await idx.persist();
    const idx2 = new VaultIndex(vault);
    const ok = await idx2.load();
    expect(ok).toBe(true);
    expect(idx2.get("a.md")?.title).toBe("Hi");
  });

  test("loadOrBuild builds when no cache", async () => {
    await vault.writeNote("z.md", "# Z");
    await idx.loadOrBuild();
    expect(idx.get("z.md")?.title).toBe("Z");
  });

  test("tags index", async () => {
    await vault.writeNote("a.md", "#foo #bar");
    await vault.writeNote("b.md", "#foo");
    await idx.buildAll();
    expect(idx.byTag("foo").sort()).toEqual(["a.md", "b.md"]);
    expect(idx.byTag("bar")).toEqual(["a.md"]);
    const all = idx.allTags();
    expect(all.find((t) => t.tag === "foo")?.count).toBe(2);
  });
});
