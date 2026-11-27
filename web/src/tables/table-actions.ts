import {
  deleteColumn,
  deleteRow,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  setAlign,
  type Align,
  type MdTable,
} from "./md-table";

export interface CellRef {
  row: number;
  col: number;
}
export type ActionGroup = "insert" | "move" | "align" | "delete";
export interface TableAction {
  id: string;
  label: string;
  shortLabel: string;
  group: ActionGroup;
  enabled: (t: MdTable, at: CellRef) => boolean;
  run: (t: MdTable, at: CellRef) => MdTable;
}

export const ACTION_GROUPS: ActionGroup[] = ["insert", "move", "align", "delete"];

const align = (id: string, label: string, short: string, value: Align): TableAction => ({
  id,
  label,
  shortLabel: short,
  group: "align",
  enabled: () => true,
  run: (t, at) => setAlign(t, at.col, value),
});

export const TABLE_ACTIONS: TableAction[] = [
  {
    id: "row-above", label: "Insert row above", shortLabel: "Row above", group: "insert",
    enabled: (_t, at) => at.row >= 0,
    run: (t, at) => insertRow(t, at.row),
  },
  {
    id: "row-below", label: "Insert row below", shortLabel: "Row below", group: "insert",
    enabled: () => true,
    run: (t, at) => insertRow(t, at.row + 1),
  },
  {
    id: "col-left", label: "Insert column left", shortLabel: "Col left", group: "insert",
    enabled: () => true,
    run: (t, at) => insertColumn(t, at.col),
  },
  {
    id: "col-right", label: "Insert column right", shortLabel: "Col right", group: "insert",
    enabled: () => true,
    run: (t, at) => insertColumn(t, at.col + 1),
  },
  {
    id: "row-up", label: "Move row up", shortLabel: "Row up", group: "move",
    enabled: (_t, at) => at.row >= 1,
    run: (t, at) => moveRow(t, at.row, at.row - 1),
  },
  {
    id: "row-down", label: "Move row down", shortLabel: "Row down", group: "move",
    enabled: (t, at) => at.row >= 0 && at.row < t.rows.length - 1,
    run: (t, at) => moveRow(t, at.row, at.row + 1),
  },
  {
    id: "col-move-left", label: "Move column left", shortLabel: "Move left", group: "move",
    enabled: (_t, at) => at.col >= 1,
    run: (t, at) => moveColumn(t, at.col, at.col - 1),
  },
  {
    id: "col-move-right", label: "Move column right", shortLabel: "Move right", group: "move",
    enabled: (t, at) => at.col < t.header.length - 1,
    run: (t, at) => moveColumn(t, at.col, at.col + 1),
  },
  align("align-left", "Align left", "Left", "left"),
  align("align-center", "Align centre", "Centre", "center"),
  align("align-right", "Align right", "Right", "right"),
  {
    id: "delete-row", label: "Delete row", shortLabel: "Del row", group: "delete",
    enabled: (_t, at) => at.row >= 0,
    run: (t, at) => deleteRow(t, at.row),
  },
  {
    id: "delete-column", label: "Delete column", shortLabel: "Del col", group: "delete",
    enabled: (t) => t.header.length > 1,
    run: (t, at) => deleteColumn(t, at.col),
  },
];
