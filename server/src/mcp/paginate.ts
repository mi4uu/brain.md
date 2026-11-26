import { z } from "zod";

// List tools return one page at a time so a large vault does not flood a
// small model's context. The page keeps the shape each tool always had
// (an array, or list_notes' object), so existing clients keep parsing it;
// when more remains, a second text block says how to fetch it.

export function pageArgs(defaultLimit: number, maxLimit: number) {
  return {
    limit: z
      .number()
      .int()
      .min(1)
      .max(maxLimit)
      .optional()
      .describe(`How many items to return (default ${defaultLimit}, max ${maxLimit}).`),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("How many items to skip. Pass next_offset from the previous call to get the next page."),
  };
}

export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  nextOffset: number | null;
}

export function paginate<T>(all: T[], limit: number | undefined, offset: number | undefined, defaultLimit: number): Page<T> {
  const start = Math.min(offset ?? 0, all.length);
  const items = all.slice(start, start + (limit ?? defaultLimit));
  const end = start + items.length;
  return { items, total: all.length, offset: start, nextOffset: end < all.length ? end : null };
}

export function pageNote(tool: string, p: Page<unknown>, what: string): string | null {
  if (p.nextOffset === null) {
    return p.offset > 0 && p.items.length === 0 ? `No more ${what}: there are ${p.total} in total.` : null;
  }
  const first = p.offset + 1;
  const last = p.offset + p.items.length;
  return (
    `Showing ${what} ${first}-${last} of ${p.total}. ` +
    `To get more, call ${tool} again with the same arguments and offset=${p.nextOffset}.`
  );
}

export function pageContent(
  tool: string,
  body: unknown,
  p: Page<unknown>,
  what: string,
): { content: Array<{ type: "text"; text: string }> } {
  const note = pageNote(tool, p, what);
  return {
    content: [
      { type: "text", text: JSON.stringify(body) },
      ...(note ? [{ type: "text" as const, text: note }] : []),
    ],
  };
}
