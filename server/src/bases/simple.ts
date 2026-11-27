import { stringify } from "yaml";
import type { SortSpec } from "@brainmd/shared/base-types";

// The `filter` / `columns` / `sort` form of query_notes, as the YAML the rest
// of the engine reads. yaml quotes an expression that would otherwise be misread.
export function simpleBase(o: { filter?: string; columns?: string[]; sort?: SortSpec[] }): string {
  const view: Record<string, unknown> = { type: "table", name: "Query" };
  if (o.filter?.trim()) view.filters = o.filter.trim();
  if (o.columns && o.columns.length > 0) view.order = o.columns;
  if (o.sort && o.sort.length > 0) view.sort = o.sort;
  return stringify({ views: [view] }, { lineWidth: 0 });
}
