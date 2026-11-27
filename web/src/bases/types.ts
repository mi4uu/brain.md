import type { BaseConfig, ViewConfig } from "@brainmd/shared/base-parse";
import type { BaseQueryResponse } from "@brainmd/shared/base-types";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import type { BaseHost } from "./host";

export type Row = BaseQueryResponse["groups"][number]["rows"][number];
export type Column = BaseQueryResponse["columns"][number];
export type PropChange = { set?: Record<string, PropValue>; unset?: string[] };

export interface LayoutProps {
  result: BaseQueryResponse;
  config: BaseConfig;
  view: ViewConfig;
  vaultTypes: Map<string, PropertyType>;
  host: BaseHost;
  saveProps(row: Row, change: PropChange, optimistic?: (r: BaseQueryResponse) => BaseQueryResponse): Promise<boolean>;
  // false when the splice was refused; the toast has been shown and nothing changed.
  editView(fn: (source: string, viewIndex: number) => string): boolean;
  newNote(preset?: Record<string, PropValue>): Promise<void>;
}
