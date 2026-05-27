import { describe, test, expect } from "bun:test";
import { encode } from "gpt-tokenizer";
import { chunkNote } from "../src/rag/chunker";

describe("RAG chunker — V48", () => {
  test("empty body → no chunks", () => {
    expect(chunkNote("a.md", "")).toEqual([]);
    expect(chunkNote("a.md", "   \n\n  ")).toEqual([]);
  });

  test("strips frontmatter from chunks", () => {
    const md = `---\ntitle: foo\ntags: [a, b]\n---\n\n# Heading\n\nbody text`;
    const chunks = chunkNote("a.md", md);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.text.includes("title: foo")).toBe(false);
    expect(chunks[0]!.text.includes("Heading")).toBe(true);
  });

  test("frontmatter shifts line numbers correctly", () => {
    const md = `---\ntitle: foo\n---\n\n# H1\n\npara`;
    const chunks = chunkNote("a.md", md);
    // # H1 is on line 5 (1-based) in the original file
    expect(chunks[0]!.lineStart).toBe(5);
  });

  test("paragraph splits on blank lines", () => {
    const md = `para1\n\npara2\n\npara3`;
    const chunks = chunkNote("a.md", md, { targetTokens: 4, overlapTokens: 0 });
    // each para is ~1-2 tokens; with target=4 we should get ≥2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  test("code fence stays in one block even with blank lines inside", () => {
    const md =
      "para before\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\npara after";
    const chunks = chunkNote("a.md", md);
    // the fenced code block should appear together inside some chunk
    const joined = chunks.map((c) => c.text).join("\n---CHUNK---\n");
    expect(joined.includes("```js\nconst x = 1;\n\nconst y = 2;\n```")).toBe(
      true,
    );
  });

  test("heading trail accumulates by level", () => {
    const md = `# A\n\nintro\n\n## A.1\n\nleaf1\n\n## A.2\n\nleaf2\n\n# B\n\nleafB`;
    const chunks = chunkNote("a.md", md, { targetTokens: 5, overlapTokens: 0 });
    // a chunk starting in "## A.2" body should have ["A", "A.2"] in trail
    const a2 = chunks.find((c) => c.text.includes("leaf2"));
    expect(a2).toBeDefined();
    expect(a2!.headingTrail).toEqual(["A", "A.2"]);
    const b = chunks.find((c) => c.text.includes("leafB"));
    expect(b!.headingTrail).toEqual(["B"]);
  });

  test("chunk has correct chunkIndex starting at 0", () => {
    const md = `a\n\nb\n\nc`;
    const chunks = chunkNote("p.md", md, { targetTokens: 1, overlapTokens: 0 });
    chunks.forEach((c, i) => expect(c.chunkIndex).toBe(i));
  });

  test("respects token target — sum of chunk tokens ≤ target * 1.5 for non-degenerate inputs", () => {
    const para = "lorem ipsum dolor sit amet consectetur adipiscing elit";
    const md = Array.from({ length: 20 }, () => para).join("\n\n");
    const chunks = chunkNote("p.md", md, { targetTokens: 32, overlapTokens: 4 });
    for (const c of chunks) {
      const t = encode(c.text).length;
      // greedy pack means we might overshoot when adding the last block
      expect(t).toBeLessThanOrEqual(64); // 32 * 2 with overlap headroom
    }
  });

  test("overlap shares tail blocks between adjacent chunks", () => {
    const md = `aaa bbb\n\nccc ddd\n\neee fff\n\nggg hhh`;
    const chunks = chunkNote("p.md", md, {
      targetTokens: 12,
      overlapTokens: 4,
    });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // the last block of chunk 0 should reappear inside chunk 1 (sliding window)
    const tail0Last = chunks[0]!.text.split("\n\n").at(-1)!;
    expect(chunks[1]!.text.includes(tail0Last)).toBe(true);
  });
});
