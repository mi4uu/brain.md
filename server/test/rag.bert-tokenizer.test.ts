import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { BertTokenizer } from "../src/rag/bert-tokenizer";

// Vocab lives outside the repo — cached at /tmp by the WASM bootstrap.
// For the test we fetch it once at module load if missing.
const VOCAB_PATH = "/tmp/bge-vocab.txt";

let tk: BertTokenizer;

beforeAll(async () => {
  if (!existsSync(VOCAB_PATH)) {
    const res = await fetch(
      "https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main/vocab.txt",
    );
    const buf = new Uint8Array(await res.arrayBuffer());
    await Bun.write(VOCAB_PATH, buf);
  }
  const txt = readFileSync(VOCAB_PATH, "utf8");
  tk = new BertTokenizer(txt, { lowercase: true, maxLen: 512 });
});

// Golden IDs verified against `bert-base-uncased` reference. bge-small
// shares this exact vocab — same IDs.
describe("BertTokenizer — golden vs reference", () => {
  test("Hello, world!", () => {
    const r = tk.encode("Hello, world!");
    expect(Array.from(r.inputIds, Number)).toEqual([
      101, 7592, 1010, 2088, 999, 102,
    ]);
  });

  test("empty string → CLS SEP only", () => {
    const r = tk.encode("");
    expect(Array.from(r.inputIds, Number)).toEqual([101, 102]);
  });

  test("WordPiece split: a long compound word produces > 2 subtokens", () => {
    // bge vocab may have 'unbelievable' as a single token, but a definitely-
    // out-of-vocab compound should split. 'megasupercaliblastic' definitely
    // isn't a vocab token.
    const r = tk.encode("megasupercaliblastic");
    expect(r.inputIds.length).toBeGreaterThan(3); // CLS + ≥2 pieces + SEP
    const ids = Array.from(r.inputIds, Number);
    expect(ids[0]).toBe(101); // CLS
    expect(ids[ids.length - 1]).toBe(102); // SEP
  });

  test("lowercase + accent strip: 'CAFÉ' encodes same as 'café'", () => {
    // We don't assert a specific ID (bge vocab content varies), only that
    // case + accent normalization makes the two equivalent.
    const a = Array.from(tk.encode("CAFÉ").inputIds, Number);
    const b = Array.from(tk.encode("café").inputIds, Number);
    expect(a).toEqual(b);
  });

  test("punctuation splits each char: 'a.b' → a . b", () => {
    // 'a' = 1037, '.' = 1012, 'b' = 1038
    const r = tk.encode("a.b");
    expect(Array.from(r.inputIds, Number)).toEqual([101, 1037, 1012, 1038, 102]);
  });

  test("genuinely out-of-vocab codepoints fall back to [UNK]", () => {
    // Supplementary-plane chars above U+10000 (musical symbols block) are
    // not in BERT/bge vocab at all.
    const junk = Array.from({ length: 16 }, (_, i) =>
      String.fromCodePoint(0x1d100 + i),
    ).join("");
    const ids = Array.from(tk.encode(junk).inputIds, Number);
    expect(ids).toContain(100); // [UNK]
  });

  test("attentionMask all 1s when no padding", () => {
    const r = tk.encode("hello world");
    expect(Array.from(r.attentionMask, Number)).toEqual([1, 1, 1, 1]);
  });

  test("padding fills with PAD + attentionMask 0s", () => {
    const r = tk.encode("hi", { padTo: 8 });
    expect(r.inputIds.length).toBe(8);
    expect(Array.from(r.inputIds, Number)).toEqual([
      101, 7632, 102, 0, 0, 0, 0, 0,
    ]);
    expect(Array.from(r.attentionMask, Number)).toEqual([
      1, 1, 1, 0, 0, 0, 0, 0,
    ]);
  });

  test("tokenTypeIds always zero for single-sequence input", () => {
    const r = tk.encode("foo bar");
    for (const v of r.tokenTypeIds) expect(v).toBe(0n);
  });

  test("max-length truncation keeps CLS + SEP", () => {
    const longText = "word ".repeat(600);
    const r = tk.encode(longText);
    expect(r.inputIds.length).toBeLessThanOrEqual(512);
    expect(r.inputIds[0]).toBe(101n);
    expect(r.inputIds[r.inputIds.length - 1]).toBe(102n);
  });
});
