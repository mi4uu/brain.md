import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import clsx from "clsx";
import type { PropValue } from "@brainmd/shared/frontmatter";
import type { PropertyType } from "@brainmd/shared/property-types";
import { api } from "../../api/client";
import { buildModel, editRename, editSet, editUnset, initialValue } from "../../properties/model";
import { useProperties } from "../../properties/useProperties";
import { useLocal } from "../../state/store";
import { ChevRightIcon, CloseIcon } from "../Icons";
import { AddProperty } from "./AddProperty";
import { TypeButton } from "./TypeButton";
import { ValueEditor } from "./ValueEditor";

interface Props {
  // Above the preview, or above the editor when the preview is hidden.
  variant: "preview" | "editor";
  notePath: string;
  content: string;
  // Applies a pure text edit to the open note: a CodeMirror transaction when
  // the editor is mounted, the content state otherwise.
  onEdit: (edit: (current: string) => string) => void;
  onFixInSource: (offset: number) => void;
  onNotice: (message: string) => void;
}

function rowEl(root: HTMLElement | null, name: string): HTMLElement | null {
  if (!root) return null;
  return Array.from(root.querySelectorAll<HTMLElement>("[data-prop-row]")).find((el) => el.dataset.propRow === name) ?? null;
}

export function PropertiesPanel({ variant, notePath, content, onEdit, onFixInSource, onNotice }: Props) {
  const [openPreview, setOpenPreview] = useLocal("brain.props.open.preview", true);
  const [openEditor, setOpenEditor] = useLocal("brain.props.open.editor", false);
  const open = variant === "preview" ? openPreview : openEditor;
  const setOpen = variant === "preview" ? setOpenPreview : setOpenEditor;

  const { infos, refresh } = useProperties(notePath);
  const model = useMemo(() => buildModel(content, infos), [content, infos]);
  const suggestions = useMemo(() => new Map(infos.map((i) => [i.name, i.values])), [infos]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ name: string; target: "row" | "value" | "add" } | null>(null);

  const run = useCallback(
    (edit: (current: string) => string, focus?: { name: string; target: "row" | "value" | "add" }) => {
      pendingFocus.current = focus ?? null;
      try {
        onEdit(edit);
      } catch (e) {
        pendingFocus.current = null;
        onNotice(e instanceof Error ? e.message : String(e));
      }
    },
    [onEdit, onNotice],
  );

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (pending.target === "add") {
      pendingFocus.current = null;
      bodyRef.current?.querySelector<HTMLElement>("[data-prop-add]")?.focus();
      return;
    }
    if (model.kind !== "rows") return;
    const row = rowEl(bodyRef.current, pending.name);
    if (!row) return;
    pendingFocus.current = null;
    if (pending.target === "value") row.querySelector<HTMLElement>("[data-prop-value]")?.focus();
    else row.focus();
  }, [model]);

  useEffect(() => {
    pendingFocus.current = null;
  }, [notePath]);

  const removeRow = (name: string) => {
    const names = model.kind === "rows" ? model.rows.map((r) => r.name) : [];
    const i = names.indexOf(name);
    const neighbour = names[i + 1] ?? names[i - 1];
    run(editUnset(name), neighbour ? { name: neighbour, target: "row" } : { name, target: "add" });
  };

  const changeType = async (name: string, type: PropertyType) => {
    try {
      await api.setPropertyType(name, type);
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onNotice(msg.startsWith("403") ? "Only the owner can change property types" : `Could not change the type: ${msg}`);
    }
  };

  const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-prop-row]"));
    const addBtn = e.currentTarget.querySelector<HTMLElement>("[data-prop-add]");
    if (target === addBtn && e.key === "ArrowUp") {
      e.preventDefault();
      (rows[rows.length - 1] ?? toggleRef.current)?.focus();
      return;
    }
    if (!target.hasAttribute("data-prop-row")) return;
    const i = rows.indexOf(target);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      (rows[i + 1] ?? addBtn)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (i > 0 ? rows[i - 1] : toggleRef.current)?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      target.querySelector<HTMLElement>("[data-prop-value]")?.focus();
    } else if (e.key === "Escape") {
      toggleRef.current?.focus();
    }
  };

  const rows = model.kind === "rows" ? model.rows : [];
  const taken = new Set(rows.map((r) => r.name));

  return (
    <section className={clsx("props-panel", variant === "editor" && "in-editor")} aria-label="Properties">
      <button
        ref={toggleRef}
        type="button"
        className="props-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && open) {
            e.preventDefault();
            (bodyRef.current?.querySelector<HTMLElement>("[data-prop-row]") ?? bodyRef.current?.querySelector<HTMLElement>("[data-prop-add]"))?.focus();
          }
        }}
      >
        <ChevRightIcon className={clsx("props-chev", open && "open")} width={12} height={12} />
        <span>{rows.length > 0 ? `Properties (${rows.length})` : "Properties"}</span>
      </button>

      {model.kind === "error" ? (
        <div className="props-error" role="alert">
          <span className="props-error-text" title={model.message}>
            {model.message.split("\n")[0]}
          </span>
          <button type="button" className="btn" onClick={() => onFixInSource(model.offset)}>
            Fix in source
          </button>
        </div>
      ) : open ? (
        <div className="props-body" ref={bodyRef} onKeyDown={onBodyKeyDown}>
          {model.kind === "rows"
            ? model.rows.map((row) => (
                <div key={row.name} className="prop-row" data-prop-row={row.name} tabIndex={-1} role="group" aria-label={row.name}>
                  <TypeButton name={row.name} type={row.type} onPick={(t) => void changeType(row.name, t)} />
                  <NameInput
                    name={row.name}
                    taken={taken}
                    onNotice={onNotice}
                    onRename={(to) => run(editRename(row.name, to), { name: to, target: "row" })}
                    onRemove={() => removeRow(row.name)}
                    onLeave={() => rowEl(bodyRef.current, row.name)?.focus()}
                  />
                  <div className="prop-value">
                    <ValueEditor
                      row={row}
                      suggestions={suggestions.get(row.name) ?? []}
                      onCommit={(v: PropValue) => run(editSet(row.name, v))}
                      onLeave={() => rowEl(bodyRef.current, row.name)?.focus()}
                      onEditInSource={() => onFixInSource(model.offset)}
                    />
                  </div>
                  <button
                    type="button"
                    className="prop-remove"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => removeRow(row.name)}
                  >
                    <CloseIcon width={12} height={12} />
                  </button>
                </div>
              ))
            : null}
          <AddProperty
            infos={infos}
            existing={taken}
            onOpen={refresh}
            onAdd={(name, type) => {
              run(editSet(name, initialValue(type)), { name, target: "value" });
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

function NameInput({
  name,
  taken,
  onNotice,
  onRename,
  onRemove,
  onLeave,
}: {
  name: string;
  taken: Set<string>;
  onNotice: (message: string) => void;
  onRename: (to: string) => void;
  onRemove: () => void;
  onLeave: () => void;
}) {
  return (
    <input
      className="prop-name"
      aria-label="Property name"
      defaultValue={name}
      key={name}
      spellCheck={false}
      onBlur={(e) => {
        const to = e.currentTarget.value.trim();
        if (to === name) return;
        if (to === "" || to === "__proto__") {
          e.currentTarget.value = name;
          return;
        }
        if (taken.has(to)) {
          e.currentTarget.value = name;
          onNotice(`"${to}" already exists in this note`);
          return;
        }
        onRename(to);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          onLeave();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.value = name;
          onLeave();
        } else if (e.key === "Backspace" && !e.repeat && e.currentTarget.value === "") {
          e.preventDefault();
          onRemove();
        }
      }}
    />
  );
}
