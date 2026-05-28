// V60: pure-JS BERT WordPiece tokenizer for bge-small (and any other
// `bert-base-uncased`-style vocab). Replaces @huggingface/tokenizers (a
// native N-API package) so the local embedder ships in a single Bun
// `--compile` binary with no dlopen.
//
// Implements the algorithm from `transformers.BertTokenizer` faithfully
// enough for English text + emoji/punctuation. Golden tests pin the
// output against bert-base-uncased reference IDs.
//
// Public API:
//   const tk = new BertTokenizer(vocabText, { lowercase: true, maxLen: 512 });
//   const { inputIds, attentionMask, tokenTypeIds } = tk.encode(text);

const PUNCT_RE =
  /[!-/:-@[-`{-~¡-¿‐-‧　-〿＀-･]/;
const WHITESPACE_RE = /[\s ]+/;

function isPunctuation(ch: string): boolean {
  if (PUNCT_RE.test(ch)) return true;
  const code = ch.codePointAt(0) ?? 0;
  // ASCII punctuation outside the regex (edge cases)
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

function isControl(ch: string): boolean {
  if (ch === "\t" || ch === "\n" || ch === "\r") return false;
  const cat = ch.charCodeAt(0);
  // C0 + DEL + most C1 controls
  if (cat < 0x20 || (cat >= 0x7f && cat <= 0x9f)) return true;
  return false;
}

function cleanText(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0 || code === 0xfffd || isControl(ch)) continue;
    if (/\s/.test(ch)) {
      out += " ";
    } else {
      out += ch;
    }
  }
  return out;
}

// Strip combining marks (accent removal) by normalizing NFD and dropping
// chars in the Combining Marks Unicode block (0x0300–0x036F).
function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{Mn}+/gu, "");
}

function splitOnPunctuation(token: string): string[] {
  const parts: string[] = [];
  let buf = "";
  for (const ch of token) {
    if (isPunctuation(ch)) {
      if (buf) parts.push(buf);
      parts.push(ch);
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

interface TokenizerOptions {
  lowercase?: boolean;
  maxLen?: number;
  // Special-token IDs for bge-small / bert-base-uncased vocab. Override
  // only if the vocab puts them at non-standard positions.
  padId?: number;
  unkId?: number;
  clsId?: number;
  sepId?: number;
}

export interface TokenizerEncoding {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
  length: number;
}

export class BertTokenizer {
  readonly vocab: Map<string, number>;
  readonly lowercase: boolean;
  readonly maxLen: number;
  readonly padId: number;
  readonly unkId: number;
  readonly clsId: number;
  readonly sepId: number;
  readonly maxInputCharsPerWord = 100;

  constructor(vocabText: string, opts: TokenizerOptions = {}) {
    this.vocab = new Map();
    const lines = vocabText.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const w = lines[i];
      if (w === undefined) continue;
      // The vocab.txt file format: one token per line, ID = line index.
      // Trailing empty line is ignored.
      if (w === "" && i === lines.length - 1) continue;
      this.vocab.set(w, i);
    }
    this.lowercase = opts.lowercase ?? true;
    this.maxLen = opts.maxLen ?? 512;
    this.padId = opts.padId ?? 0;
    this.unkId = opts.unkId ?? 100;
    this.clsId = opts.clsId ?? 101;
    this.sepId = opts.sepId ?? 102;
  }

  private basicTokenize(text: string): string[] {
    const cleaned = cleanText(text);
    const splits = cleaned.split(WHITESPACE_RE).filter((s) => s.length > 0);
    const out: string[] = [];
    for (let token of splits) {
      if (this.lowercase) {
        token = token.toLowerCase();
        token = stripAccents(token);
      }
      for (const piece of splitOnPunctuation(token)) {
        if (piece) out.push(piece);
      }
    }
    return out;
  }

  private wordpieceTokenize(token: string): string[] {
    if (token.length > this.maxInputCharsPerWord) return ["[UNK]"];
    const chars = Array.from(token); // codepoint-safe
    let start = 0;
    const subTokens: string[] = [];
    while (start < chars.length) {
      let end = chars.length;
      let curSub: string | null = null;
      while (start < end) {
        let sub = chars.slice(start, end).join("");
        if (start > 0) sub = "##" + sub;
        if (this.vocab.has(sub)) {
          curSub = sub;
          break;
        }
        end--;
      }
      if (curSub === null) return ["[UNK]"];
      subTokens.push(curSub);
      start = end;
    }
    return subTokens;
  }

  // Token IDs only — used by encode() which adds CLS/SEP and pads.
  tokenize(text: string): number[] {
    const out: number[] = [];
    for (const basic of this.basicTokenize(text)) {
      for (const piece of this.wordpieceTokenize(basic)) {
        out.push(this.vocab.get(piece) ?? this.unkId);
      }
    }
    return out;
  }

  // Returns ORT-ready BigInt64Arrays. Truncates to maxLen - 2 (room for
  // CLS + SEP). Pads to a length of `padTo` (default = actual length, no
  // pad). For single-sequence inference no padding is needed.
  encode(text: string, opts: { padTo?: number } = {}): TokenizerEncoding {
    const truncated = this.tokenize(text).slice(0, this.maxLen - 2);
    const ids = [this.clsId, ...truncated, this.sepId];
    const realLen = ids.length;
    const padTo = opts.padTo ?? realLen;
    while (ids.length < padTo) ids.push(this.padId);

    const inputIds = new BigInt64Array(ids.map((n) => BigInt(n)));
    const attentionMask = new BigInt64Array(
      ids.map((_, i) => (i < realLen ? 1n : 0n)),
    );
    const tokenTypeIds = new BigInt64Array(ids.length); // all 0 for single seq
    return { inputIds, attentionMask, tokenTypeIds, length: realLen };
  }
}
