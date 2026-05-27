import { describe, test, expect } from "bun:test";
import {
  contextForQuery,
  semanticOutline,
  weeklyDigest,
  compareNotes,
  orphans,
  related,
  similarTasks,
  RagDisabledError,
  type RagDeps,
} from "../src/rag/queries";
import type { SearchHit, TaskHit } from "../src/rag/types";
import type { TaskDoneFilter } from "../src/rag/store";

// V54: queries layer unit tests with hand-rolled deps. We deliberately
// avoid spinning up LanceDB or a real embedder — we only need to verify
// composition (perm filtering, budget packing, ordering, dedupe).

function makeVec(values: number[]): Float32Array {
  return new Float32Array(values);
}

interface NoteSpec {
  path: string;
  body: string;
  mtime?: number;
}

function makeDeps(opts: {
  notes: NoteSpec[];
  backlinks?: Record<string, string[]>;
  embed?: (texts: string[]) => Promise<Float32Array[]>;
  search?: (vec: Float32Array, k: number) => Promise<SearchHit[]>;
  searchTasks?: (
    vec: Float32Array,
    k: number,
    filter: TaskDoneFilter,
  ) => Promise<TaskHit[]>;
  perms?: Record<string, { read: boolean; write: boolean }>;
  enabled?: boolean;
}): RagDeps {
  const notesByPath = new Map(opts.notes.map((n) => [n.path, n]));
  const vault = {
    readNote: async (rel: string) => {
      const n = notesByPath.get(rel);
      if (!n) throw new Error(`stub vault: missing ${rel}`);
      return { content: n.body, mtime: n.mtime ?? 0 };
    },
    // The folder-perm loader reads `.brain/folders.json`; without that
    // file the loader returns `{ mcp: {} }`, which means default perms
    // (read/write true) for every path — exactly what most tests want.
    root: "/tmp/nonexistent-brain-queries-test",
  } as unknown as RagDeps["vault"];

  const entries = opts.notes.map((n) => ({
    path: n.path,
    body: n.body,
    mtime: n.mtime ?? 0,
  }));
  const index = {
    entries: () => entries,
    backlinks: (toPath: string) =>
      (opts.backlinks?.[toPath] ?? []).map((from) => ({
        from,
        lineNo: 1,
        context: "",
        embed: false,
      })),
  } as unknown as RagDeps["index"];

  const pipeline = {
    embed: opts.embed ?? (async (texts: string[]) => texts.map(() => makeVec([1, 0, 0]))),
    store: {
      search: opts.search ?? (async () => []),
      searchTasks: opts.searchTasks ?? (async () => []),
    },
  } as unknown as RagDeps["pipeline"];

  return {
    vault,
    index,
    pipeline,
    ragEnabled: () => opts.enabled ?? true,
  };
}

describe("queries — V54 perm + composition", () => {
  test("every function throws RagDisabledError when ragEnabled=false", async () => {
    const deps = makeDeps({ notes: [], enabled: false });
    await expect(related(deps, "a.md")).rejects.toBeInstanceOf(RagDisabledError);
    await expect(contextForQuery(deps, "x")).rejects.toBeInstanceOf(
      RagDisabledError,
    );
    await expect(semanticOutline(deps, "a.md")).rejects.toBeInstanceOf(
      RagDisabledError,
    );
    await expect(orphans(deps)).rejects.toBeInstanceOf(RagDisabledError);
    await expect(weeklyDigest(deps)).rejects.toBeInstanceOf(RagDisabledError);
    await expect(similarTasks(deps, "x")).rejects.toBeInstanceOf(
      RagDisabledError,
    );
  });

  test("related excludes the same path from results", async () => {
    const deps = makeDeps({
      notes: [{ path: "a.md", body: "# A\n\nseed text" }],
      search: async () => [
        {
          path: "a.md",
          chunkIndex: 0,
          score: 0.99,
          snippet: "self",
          headingTrail: [],
          lineStart: 1,
          lineEnd: 1,
        },
        {
          path: "b.md",
          chunkIndex: 0,
          score: 0.8,
          snippet: "other",
          headingTrail: [],
          lineStart: 1,
          lineEnd: 1,
        },
      ],
    });
    const out = await related(deps, "a.md", 5);
    expect(out.map((h) => h.path)).toEqual(["b.md"]);
  });

  test("contextForQuery packs blocks until budget exceeded and reports truncation", async () => {
    const big = "lorem ".repeat(200); // ~200 tokens
    const deps = makeDeps({
      notes: [],
      search: async () => [
        {
          path: "a.md",
          chunkIndex: 0,
          score: 0.9,
          snippet: big,
          headingTrail: [],
          lineStart: 1,
          lineEnd: 1,
        },
        {
          path: "b.md",
          chunkIndex: 0,
          score: 0.8,
          snippet: big,
          headingTrail: [],
          lineStart: 1,
          lineEnd: 1,
        },
        {
          path: "c.md",
          chunkIndex: 0,
          score: 0.7,
          snippet: big,
          headingTrail: [],
          lineStart: 1,
          lineEnd: 1,
        },
      ],
    });
    const out = await contextForQuery(deps, "anything", 250);
    // First block always lands; subsequent attempts blow the budget → truncated.
    expect(out.sources.length).toBe(1);
    expect(out.truncated).toBe(true);
    expect(out.text.includes("a.md")).toBe(true);
  });

  test("contextForQuery dedupes by path, keeping highest score", async () => {
    const deps = makeDeps({
      notes: [],
      search: async () => [
        {
          path: "a.md",
          chunkIndex: 0,
          score: 0.6,
          snippet: "lo",
          headingTrail: [],
          lineStart: 1,
          lineEnd: 1,
        },
        {
          path: "a.md",
          chunkIndex: 1,
          score: 0.9,
          snippet: "hi",
          headingTrail: [],
          lineStart: 2,
          lineEnd: 2,
        },
        {
          path: "b.md",
          chunkIndex: 0,
          score: 0.5,
          snippet: "b",
          headingTrail: [],
          lineStart: 1,
          lineEnd: 1,
        },
      ],
    });
    const out = await contextForQuery(deps, "q", 10_000);
    expect(out.sources.map((s) => s.path)).toEqual(["a.md", "b.md"]);
    expect(out.sources[0]!.score).toBe(0.9);
  });

  test("similarTasks passes filter through and excludes nothing on default perms", async () => {
    let seenFilter: TaskDoneFilter | undefined;
    const deps = makeDeps({
      notes: [],
      searchTasks: async (_v, _k, filter) => {
        seenFilter = filter;
        return [
          { path: "a.md", lineNo: 3, text: "todo a", done: false, score: 0.7 },
          { path: "b.md", lineNo: 5, text: "todo b", done: false, score: 0.6 },
        ];
      },
    });
    const out = await similarTasks(deps, "todo", 5, "open");
    expect(seenFilter).toBe("open");
    expect(out.map((t) => t.path)).toEqual(["a.md", "b.md"]);
  });

  test("orphans returns notes with zero backlinks above isolation cutoff", async () => {
    const deps = makeDeps({
      notes: [
        { path: "lonely.md", body: "# Lonely\n\nrare topic" },
        { path: "linked.md", body: "# Linked\n\ncommon topic" },
      ],
      backlinks: { "lonely.md": [], "linked.md": ["other.md"] },
      // Always report a very weak best neighbour → isolation = 1 - 0.1 = 0.9
      search: async () => [
        {
          path: "_other_",
          chunkIndex: 0,
          score: 0.1,
          snippet: "",
          headingTrail: [],
          lineStart: 1,
          lineEnd: 1,
        },
      ],
    });
    const out = await orphans(deps, 5, 0.35);
    expect(out.map((o) => o.path)).toEqual(["lonely.md"]);
    expect(out[0]!.isolation).toBeGreaterThanOrEqual(0.35);
  });

  test("weeklyDigest filters notes by mtime cutoff", async () => {
    const now = Date.now();
    const week = 7 * 24 * 3600 * 1000;
    const deps = makeDeps({
      notes: [
        { path: "fresh.md", body: "# Fresh\n\nrecent stuff", mtime: now - 1000 },
        { path: "stale.md", body: "# Stale\n\nold stuff", mtime: now - 2 * week },
      ],
      // Deterministic embeddings so the clusterer runs without surprises.
      embed: async (texts) => texts.map(() => makeVec([1, 0, 0])),
    });
    const out = await weeklyDigest(deps, "7d", 0.6);
    const allPaths = out.flatMap((c) => c.paths);
    expect(allPaths).toContain("fresh.md");
    expect(allPaths).not.toContain("stale.md");
  });

  test("compareNotes returns cosine ∈ [0,1] + unified diff for differing lines", async () => {
    const deps = makeDeps({
      notes: [
        { path: "a.md", body: "# Same\n\nfirst line\nA only" },
        { path: "b.md", body: "# Same\n\nfirst line\nB only" },
      ],
      // Identical embeddings → cosine = 1.
      embed: async (texts) => texts.map(() => makeVec([1, 0, 0])),
    });
    const out = await compareNotes(deps, "a.md", "b.md");
    expect(out.cosine).toBeGreaterThan(0.99);
    expect(out.unifiedDiff).toContain("-A only");
    expect(out.unifiedDiff).toContain("+B only");
    // sharedHeadings is best-effort: it only populates when a heading
    // lives in a different chunk than the body. Just assert it's an array.
    expect(Array.isArray(out.sharedHeadings)).toBe(true);
  });

  test("semanticOutline clusters chunks with cosine ≥ threshold into one group", async () => {
    // Big enough body to produce ≥2 chunks under default target.
    const para = "alpha beta gamma delta epsilon zeta eta theta ";
    const body =
      "# Heading\n\n" + Array.from({ length: 60 }, () => para).join("\n\n");
    const deps = makeDeps({
      notes: [{ path: "x.md", body }],
      // All chunks get the same vector → single cluster regardless of count.
      embed: async (texts) => texts.map(() => makeVec([1, 0, 0])),
    });
    const out = await semanticOutline(deps, "x.md", 0.5);
    expect(out.length).toBe(1);
    expect(out[0]!.chunkCount).toBeGreaterThanOrEqual(1);
  });
});
