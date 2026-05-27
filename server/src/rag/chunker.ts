import type { Chunk } from "./types";

// Stub — real impl lands in T99. Signature is the contract.
export function chunkNote(
  _path: string,
  _content: string,
  _opts?: { targetTokens?: number; overlapTokens?: number },
): Chunk[] {
  throw new Error("chunkNote not implemented (T99)");
}
