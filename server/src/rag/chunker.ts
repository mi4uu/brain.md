import { encode } from "gpt-tokenizer";
import {
  CHUNK_OVERLAP_TOKENS,
  CHUNK_TARGET_TOKENS,
  type Chunk,
  type TaskChunk,
} from "./types";

// V55: a task line in markdown.
// Captures: leading bullet+space, [x|X|space], text after the checkbox.
// We anchor to start-of-line because task lines must be top-level on their line.
const TASK_RE = /^(\s*[-*+])\s+\[([ xX])\]\s+(.+)$/;

interface Block {
  text: string;
  lineStart: number; // 1-based, inclusive
  lineEnd: number; // 1-based, inclusive
  heading: { level: number; text: string } | null;
}

// V48: deterministic paragraph-based chunker.
// Pipeline: strip frontmatter → blockify (paragraph + heading aware,
// code-fence safe) → greedy pack ≤512 tokens w/ 64-token overlap.
// Returns chunks tagged with their heading trail and source line range.

export function chunkNote(
  path: string,
  content: string,
  opts: { targetTokens?: number; overlapTokens?: number } = {},
): Chunk[] {
  const target = opts.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlap = opts.overlapTokens ?? CHUNK_OVERLAP_TOKENS;

  const { body, bodyOffset } = stripFrontmatter(content);
  if (body.trim() === "") return [];

  const blocks = blockify(body, bodyOffset);
  if (blocks.length === 0) return [];

  return packBlocks(path, blocks, target, overlap);
}

// V55: extract task lines into one TaskChunk each. Reuses the
// frontmatter strip so lineNo aligns with the original file. Lines
// matching the TASK_RE are reported by their 1-based source line.
export function chunkTasks(path: string, content: string): TaskChunk[] {
  const { body, bodyOffset } = stripFrontmatter(content);
  if (body === "") return [];
  const out: TaskChunk[] = [];
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = TASK_RE.exec(lines[i] ?? "");
    if (!m) continue;
    const checkbox = (m[2] ?? " ").toLowerCase();
    out.push({
      path,
      lineNo: i + 1 + bodyOffset,
      text: (m[3] ?? "").trim(),
      done: checkbox === "x",
    });
  }
  return out;
}

function stripFrontmatter(content: string): { body: string; bodyOffset: number } {
  if (!content.startsWith("---")) return { body: content, bodyOffset: 0 };
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content);
  if (!m) return { body: content, bodyOffset: 0 };
  const consumed = m[0];
  const linesConsumed = consumed.split(/\r?\n/).length - 1;
  return { body: content.slice(consumed.length), bodyOffset: linesConsumed };
}

function blockify(body: string, bodyOffset: number): Block[] {
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  let buf: string[] = [];
  let bufStart = -1;
  let inFence = false;
  let fenceMarker = "";

  const flush = (endIdx: number) => {
    if (buf.length === 0) return;
    const text = buf.join("\n").trim();
    if (text === "") {
      buf = [];
      return;
    }
    blocks.push({
      text,
      lineStart: bufStart + 1 + bodyOffset,
      lineEnd: endIdx + 1 + bodyOffset,
      heading: detectHeading(text),
    });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fenceMatch = /^(\s*)(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fenceMatch[2] ?? "```";
      } else if (line.trimStart().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = "";
      }
      if (buf.length === 0) bufStart = i;
      buf.push(line);
      continue;
    }
    if (inFence) {
      if (buf.length === 0) bufStart = i;
      buf.push(line);
      continue;
    }
    if (line.trim() === "") {
      flush(i - 1);
      continue;
    }
    if (buf.length === 0) bufStart = i;
    buf.push(line);
  }
  flush(lines.length - 1);
  return blocks;
}

function detectHeading(text: string): { level: number; text: string } | null {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(first);
  if (!m) return null;
  return { level: m[1]!.length, text: m[2]!.trim() };
}

function tokensIn(s: string): number {
  return encode(s).length;
}

// Build the overlap suffix: take complete trailing blocks from the
// previous chunk until they total ~overlap tokens. Block-aligned to
// keep semantic chunks intact.
function buildOverlap(prevBlocks: Block[], overlap: number): Block[] {
  const tail: Block[] = [];
  let tokens = 0;
  for (let i = prevBlocks.length - 1; i >= 0 && tokens < overlap; i--) {
    const b = prevBlocks[i]!;
    tail.unshift(b);
    tokens += tokensIn(b.text);
  }
  return tail;
}

function packBlocks(
  path: string,
  blocks: Block[],
  target: number,
  overlap: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  const trail: string[] = []; // running heading trail (h1..h6)
  let cur: Block[] = [];
  let curTokens = 0;
  let chunkTrailAtStart: string[] = [];

  const updateTrail = (b: Block) => {
    if (!b.heading) return;
    const { level, text } = b.heading;
    // shrink to (level-1) then push
    trail.length = Math.max(0, level - 1);
    trail[level - 1] = text;
    // clear anything beyond level
    trail.length = level;
  };

  const emit = () => {
    if (cur.length === 0) return;
    const first = cur[0]!;
    const last = cur[cur.length - 1]!;
    chunks.push({
      path,
      chunkIndex: chunks.length,
      text: cur.map((b) => b.text).join("\n\n"),
      headingTrail: chunkTrailAtStart.filter((t): t is string => !!t),
      lineStart: first.lineStart,
      lineEnd: last.lineEnd,
    });
  };

  for (const b of blocks) {
    const bt = tokensIn(b.text);
    if (cur.length === 0) {
      chunkTrailAtStart = [...trail];
      cur.push(b);
      curTokens = bt;
      updateTrail(b);
      continue;
    }
    if (curTokens + bt > target) {
      // emit current chunk, start a new one with overlap
      emit();
      const overlapBlocks = buildOverlap(cur, overlap);
      cur = [...overlapBlocks];
      curTokens = overlapBlocks.reduce((n, x) => n + tokensIn(x.text), 0);
      // trail at start of new chunk = current running trail (already includes
      // anything the overlap blocks may have updated previously)
      chunkTrailAtStart = [...trail];
      cur.push(b);
      curTokens += bt;
      updateTrail(b);
      continue;
    }
    cur.push(b);
    curTokens += bt;
    updateTrail(b);
  }
  emit();
  return chunks;
}
