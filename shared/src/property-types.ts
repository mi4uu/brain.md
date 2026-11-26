import type { PropValue } from "./frontmatter";

export const PROPERTY_TYPES = ["text", "multitext", "number", "checkbox", "date", "datetime", "tags", "aliases"] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface TypesFile {
  types: Record<string, string>;
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

export function isPropertyType(s: unknown): s is PropertyType {
  return typeof s === "string" && (PROPERTY_TYPES as readonly string[]).includes(s);
}

export function normalizeType(s: unknown): PropertyType {
  return isPropertyType(s) ? s : "text";
}

export function inferType(values: PropValue[]): PropertyType {
  const vs = values.filter((v) => v !== null);
  if (vs.length === 0) return "text";
  if (vs.some((v) => Array.isArray(v))) return "multitext";
  if (vs.every((v) => typeof v === "boolean")) return "checkbox";
  if (vs.every((v) => typeof v === "number")) return "number";
  if (vs.every((v) => typeof v === "string")) {
    const strs = vs as string[];
    if (strs.every((s) => DATE_RE.test(s))) return "date";
    if (strs.every((s) => DATE_RE.test(s) || DATETIME_RE.test(s))) return "datetime";
  }
  return "text";
}

export interface PropertyInfo {
  name: string;
  type: PropertyType;
  count: number;
  values: PropValue[];
}

const FIXED_TYPES: Record<string, PropertyType> = { tags: "tags", aliases: "aliases" };

// `tags` and `aliases` are fixed; otherwise a registered type wins over the
// inferred one.
export function resolveType(name: string, registered: PropertyType | undefined, inferred: PropertyType): PropertyType {
  if (Object.hasOwn(FIXED_TYPES, name)) return FIXED_TYPES[name]!;
  return registered ?? inferred;
}
