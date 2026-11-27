import type { PropValue } from "./frontmatter";
import type { PropertyType } from "./property-types";

export type Direction = "ASC" | "DESC";

export interface SortSpec {
  property: string;
  direction: Direction;
}

export type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] };

export interface BaseQueryRequest {
  source: string;
  view?: string;
  thisPath?: string;
  offset?: number;
  limit?: number;
}

export interface BaseQueryResponse {
  views: Array<{ name: string; type: string }>;
  view: string;
  columns: Array<{ key: string; label: string; type: PropertyType | "file" | "formula" }>;
  groups: Array<{
    key: string | null;
    label: string;
    count: number;
    rows: Array<{ path: string; title: string; revision: string; values: Record<string, PropValue> }>;
  }>;
  total: number;
  warnings: string[];
}

export const DEFAULT_QUERY_LIMIT = 500;
export const MAX_QUERY_LIMIT = 2000;
