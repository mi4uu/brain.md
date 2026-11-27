import { completionStatus } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import type { Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { tableEdit } from "./apply";
import type { LineRange, MdTable } from "./md-table";
import { enterEdit, formatEdit, tabEdit, type CursorEdit } from "./navigate";

export type ViewLike = Pick<EditorView, "state" | "dispatch">;

// Tab selects the next cell's text, so every table key must accept a selection that stays on one line.
function runCursorEdit(view: ViewLike, make: (text: string, pos: number) => CursorEdit | null): boolean {
  const { state } = view;
  const sel = state.selection.main;
  if (completionStatus(state) !== null) return false;
  const line = state.doc.lineAt(sel.from);
  if (!line.text.includes("|")) return false;
  if (!sel.empty && line.number !== state.doc.lineAt(sel.to).number) return false;
  const edit = make(state.doc.toString(), sel.from);
  if (!edit) return false;
  const changed = edit.from !== edit.to || edit.insert !== "";
  view.dispatch({
    changes: changed ? { from: edit.from, to: edit.to, insert: edit.insert } : undefined,
    selection: { anchor: edit.anchor, head: edit.head },
    scrollIntoView: true,
    userEvent: "input.table",
    annotations: isolateHistory.of("full"),
  });
  return true;
}

export const formatTable = (view: ViewLike): boolean => runCursorEdit(view, formatEdit);

export const tableTab =
  (dir: 1 | -1) =>
  (view: ViewLike): boolean =>
    runCursorEdit(view, (t, p) => tabEdit(t, p, dir));

export const tableEnter = (view: ViewLike): boolean =>
  runCursorEdit(view, enterEdit);

export const tableKeymap: Extension = keymap.of([
  { key: "Tab", run: tableTab(1) },
  { key: "Shift-Tab", run: tableTab(-1) },
  { key: "Enter", run: tableEnter },
  { key: "Mod-Alt-t", run: formatTable },
]);

export function dispatchTableEdit(
  view: ViewLike,
  range: LineRange,
  fn: (t: MdTable) => MdTable,
): boolean {
  const edit = tableEdit(view.state.doc.toString(), range, fn);
  if (!edit) return false;
  if (edit.from === edit.to && edit.insert === "") return true;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    userEvent: "input.table",
    annotations: isolateHistory.of("full"),
  });
  return true;
}
