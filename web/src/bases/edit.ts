import { findBaseFences, replaceFenceBody } from "@brainmd/shared/base-yaml";
import type { TextEdit } from "../tables/apply";

export { applyEdit, type TextEdit } from "../tables/apply";

// The edit that rewrites the body of the ```base fence opening on `startLine`
// (1-based) with `mutate(oldYaml)`. null when no base fence opens there.
// `expected` is the source the view was rendered from: when the fence now on
// that line differs (an earlier fence was deleted), the edit is refused.
export function fenceEdit(text: string, startLine: number, mutate: (source: string) => string, expected?: string): TextEdit | null {
  const fence = findBaseFences(text).find((f) => f.startLine === startLine);
  if (!fence) return null;
  if (expected !== undefined && fence.source !== expected.replace(/\r\n/g, "\n")) return null;
  const next = mutate(fence.source);
  if (next === fence.source) return { from: fence.from, to: fence.from, insert: "" };
  return replaceFenceBody(text, fence, next);
}
