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

// Whether a placeholder in the rendered HTML stands for a real ```base fence of
// `text`. Raw HTML can carry a hand-made `.base-block`, which must not get a
// live, writing view.
export const isLiveFence = (text: string, startLine: number, source: string): boolean =>
  fenceEdit(text, startLine, (s) => s, source) !== null;

// Whether the mounted view at an ordinal goes on rendering the block now at
// that ordinal. An edited fence keeps its root, so open popovers, focus and
// typed drafts survive the view's own edits. When blocks were added or removed
// the ordinal may now name another block, so only an unchanged source is kept.
export const keepRoot = (old: string | undefined, source: string, sameCount: boolean): boolean =>
  old !== undefined && (old === source || sameCount);
