import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { LinkResolver, normalizeTarget } from "../src/index/resolve";

const entry = (path: string, aliases: string[] = []) => ({
  path,
  basenameLower: path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "").toLowerCase(),
  aliases,
});

test("the web app's copy of the resolver matches the server's", () => {
  const server = readFileSync(join(import.meta.dir, "../src/index/resolve.ts"), "utf8");
  const web = readFileSync(join(import.meta.dir, "../../web/src/lib/link-resolve.ts"), "utf8");
  expect(web).toBe(server);
});

describe("normalizeTarget", () => {
  test("drops .md, headings, block refs and a leading slash, lowercases", () => {
    expect(normalizeTarget("Ludzie/Kamil.md")).toBe("ludzie/kamil");
    expect(normalizeTarget("note#Heading")).toBe("note");
    expect(normalizeTarget("note^block")).toBe("note");
    expect(normalizeTarget("/dir/note")).toBe("dir/note");
    expect(normalizeTarget("#Heading")).toBe("");
  });
});

describe("LinkResolver", () => {
  const r = new LinkResolver([
    entry("Start.md"),
    entry("ludzie/Index.md"),
    entry("ludzie/kamil.md", ["Kamilek"]),
    entry("private/rodzina/marysia-szkola.md"),
    entry("work/job-search/Index.md"),
    entry("work/job-search/notes/a.md"),
    entry("archive/old/Index.md"),
  ]);

  test("full vault path, with or without .md, any case", () => {
    expect(r.resolve("Start.md", "private/rodzina/marysia-szkola")).toBe("private/rodzina/marysia-szkola.md");
    expect(r.resolve("Start.md", "ludzie/kamil.md")).toBe("ludzie/kamil.md");
    expect(r.resolve("Start.md", "Ludzie/Index")).toBe("ludzie/Index.md");
  });

  test("path with a heading still points at the note", () => {
    expect(r.resolve("Start.md", "ludzie/kamil#Kontakt")).toBe("ludzie/kamil.md");
  });

  test("path relative to the linking note and a path suffix", () => {
    expect(r.resolve("work/job-search/notes/a.md", "../Index")).toBe("work/job-search/Index.md");
    expect(r.resolve("Start.md", "rodzina/marysia-szkola")).toBe("private/rodzina/marysia-szkola.md");
  });

  test("ambiguous name: the linking note's folder wins", () => {
    expect(r.resolve("work/job-search/plan.md", "Index")).toBe("work/job-search/Index.md");
    expect(r.resolve("ludzie/ola.md", "Index")).toBe("ludzie/Index.md");
  });

  test("ambiguous name from a subfolder: the nearest folder up wins over a shorter path", () => {
    expect(r.resolve("work/job-search/direct/offer.md", "Index")).toBe("work/job-search/Index.md");
    expect(r.resolve("archive/old/notes/x.md", "Index")).toBe("archive/old/Index.md");
  });

  test("ambiguous name from elsewhere: shortest path, then alphabetical", () => {
    expect(r.resolve("Start.md", "Index")).toBe("ludzie/Index.md");
  });

  test("relative links that leave the vault stay unresolved; /path starts at the root", () => {
    const rr = new LinkResolver([entry("Index.md"), entry("ludzie/Index.md"), entry("v1.2 plan.md")]);
    expect(rr.resolve("ludzie/a.md", "../../Index")).toBeUndefined();
    expect(rr.resolve("ludzie/a.md", "/Index")).toBe("Index.md");
    expect(rr.resolve("ludzie/a.md", "Index")).toBe("ludzie/Index.md");
    expect(rr.resolve("ludzie/a.md", "v1.2 plan")).toBe("v1.2 plan.md");
    expect(rr.resolve("ludzie/a.md", "^block")).toBeUndefined();
  });

  test("alias, and a link to the note itself", () => {
    expect(r.resolve("Start.md", "kamilek")).toBe("ludzie/kamil.md");
    expect(r.resolve("Start.md", "#Heading")).toBeUndefined();
    expect(r.resolve("Start.md", "nope")).toBeUndefined();
  });
});

describe("backlinks and graph use the resolver", () => {
  let handle!: AppHandle;
  let dir!: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "brain-link-resolve-"));
    handle = createApp({ vaultDir: dir, gitAutocommit: false });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function write(path: string, content: string): Promise<void> {
    await handle.vault.writeNote(path, content);
    await handle.index.updatePath(path);
  }

  const from = (path: string) => handle.index.backlinks(path).map((b) => b.from).sort();

  test("path-qualified, .md, alias and heading links count as backlinks", async () => {
    await write("ludzie/kamil.md", "# Kamil\n");
    await write("ludzie/Index.md", "- [[ludzie/kamil]]\n");
    await write("Start.md", "[[ludzie/kamil.md|Kamil]] and [[ludzie/Index]]\n");
    await write("daily/today.md", "met [[kamil#Kontakt]]\n");
    expect(from("ludzie/kamil.md")).toEqual(["Start.md", "daily/today.md", "ludzie/Index.md"]);
    expect(from("ludzie/Index.md")).toEqual(["Start.md"]);
  });

  test("[[Index]] in work/job-search belongs to that folder's Index, not ludzie/Index", async () => {
    await write("ludzie/Index.md", "# People\n");
    await write("work/job-search/Index.md", "# Jobs\n");
    await write("work/job-search/lead.md", "back to [[Index]]\n");
    expect(from("work/job-search/Index.md")).toEqual(["work/job-search/lead.md"]);
    expect(from("ludzie/Index.md")).toEqual([]);
  });

  test("backlinks follow edits and deletes", async () => {
    await write("a.md", "# A\n");
    await write("b.md", "[[a]]\n");
    expect(from("a.md")).toEqual(["b.md"]);
    await write("b.md", "no links now\n");
    expect(from("a.md")).toEqual([]);
  });

  test("backlinks follow a rename", async () => {
    await write("ludzie/kamil.md", "# Kamil\n");
    await write("Start.md", "[[kamil]]\n");
    expect(from("ludzie/kamil.md")).toEqual(["Start.md"]);
    await handle.vault.renameNote("Start.md", "Home.md");
    expect(from("ludzie/kamil.md")).toEqual(["Home.md"]);
  });

  test("graph edges agree with backlinks", async () => {
    await write("ludzie/Index.md", "# People\n");
    await write("work/job-search/Index.md", "# Jobs\n");
    await write("work/job-search/lead.md", "[[Index]]\n");
    await write("Start.md", "[[private/rodzina/marysia-szkola]]\n");
    await write("private/rodzina/marysia-szkola.md", "# School\n");
    const r = await handle.app.handle(new Request("http://localhost/api/graph"));
    const g = (await r.json()) as { links: Array<{ source: string; target: string }> };
    const edges = g.links.map((l) => [l.source, l.target].sort().join(" <-> ")).sort();
    expect(edges).toEqual([
      "Start.md <-> private/rodzina/marysia-szkola.md",
      "work/job-search/Index.md <-> work/job-search/lead.md",
    ]);
  });
});
