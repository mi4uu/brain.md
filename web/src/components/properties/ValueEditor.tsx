import { useId } from "react";
import type { PropValue } from "@brainmd/shared/frontmatter";
import {
  listFor,
  nativeDate,
  nativeDateTime,
  parseNumber,
  dateCommit,
  numberCommit,
  textOf,
  toList,
  type PropRow,
} from "../../properties/model";
import { CloseIcon } from "../Icons";

interface Props {
  row: PropRow;
  // Values other notes use for this name, most common first.
  suggestions: PropValue[];
  onCommit: (value: PropValue) => void;
  // Escape: hand focus back to the row.
  onLeave: () => void;
  onEditInSource: () => void;
}

export function ValueEditor({ row, suggestions, onCommit, onLeave, onEditInSource }: Props) {
  const { type, value } = row;

  if (row.nested) {
    return (
      <div className="prop-nested">
        <code className="prop-nested-value">{JSON.stringify(value)}</code>
        <button type="button" className="prop-link" onClick={onEditInSource}>
          edit in source
        </button>
      </div>
    );
  }

  if (type === "checkbox") {
    return (
      <input
        data-prop-value
        className="prop-check"
        type="checkbox"
        aria-label={row.name}
        checked={value === true}
        onChange={(e) => onCommit(e.currentTarget.checked)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onLeave();
          }
        }}
      />
    );
  }

  if (type === "multitext" || type === "tags" || type === "aliases") {
    return (
      <Chips
        name={row.name}
        type={type}
        items={toList(value)}
        suggestions={suggestions}
        onCommit={onCommit}
        onLeave={onLeave}
      />
    );
  }

  if (type === "date" || type === "datetime") {
    const native = type === "date" ? nativeDate(value) : nativeDateTime(value);
    if (native !== null) {
      return (
        <input
          data-prop-value
          className="prop-input prop-mono"
          type={type === "date" ? "date" : "datetime-local"}
          aria-label={row.name}
          defaultValue={native}
          key={row.name}
          onBlur={(e) => {
            const d = dateCommit(e.currentTarget.value, e.currentTarget.validity.badInput, native);
            if (d.write) onCommit(d.value);
            else e.currentTarget.value = native;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
              onLeave();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.currentTarget.value = native;
              onLeave();
            }
          }}
        />
      );
    }
  }

  const text = textOf(value);
  const numeric = type === "number" && (text === "" || parseNumber(text) !== null);
  return (
    <input
      data-prop-value
      className={numeric ? "prop-input prop-mono" : "prop-input"}
      type={numeric ? "number" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      aria-label={row.name}
      defaultValue={text}
      key={text}
      spellCheck={false}
      onBlur={(e) => {
        const raw = e.currentTarget.value;
        if (numeric) {
          const d = numberCommit(raw, e.currentTarget.validity.badInput, text);
          if (d.write) onCommit(d.value);
          else e.currentTarget.value = text;
          return;
        }
        if (raw === text) return;
        onCommit(raw === "" ? null : raw);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
          onLeave();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.currentTarget.value = text;
          onLeave();
        }
      }}
    />
  );
}

function Chips({
  name,
  type,
  items,
  suggestions,
  onCommit,
  onLeave,
}: {
  name: string;
  type: PropRow["type"];
  items: string[];
  suggestions: PropValue[];
  onCommit: (value: PropValue) => void;
  onLeave: () => void;
}) {
  const listId = useId();
  const suggested = suggestions
    .filter((s): s is string => typeof s === "string" && !items.includes(s))
    .slice(0, 20);

  const add = (input: HTMLInputElement) => {
    const next = listFor(type, [...items, input.value]);
    input.value = "";
    if (next.length !== items.length) onCommit(next);
  };

  return (
    <div className="prop-chips">
      {items.map((item) => (
        <span className="prop-chip" key={item}>
          {item}
          <button
            type="button"
            className="prop-chip-x"
            aria-label={`Remove ${item}`}
            onClick={() => onCommit(listFor(type, items.filter((x) => x !== item)))}
          >
            <CloseIcon width={10} height={10} />
          </button>
        </span>
      ))}
      <input
        data-prop-value
        className="prop-chip-input"
        list={listId}
        aria-label={`Add to ${name}`}
        placeholder={items.length === 0 ? "Add" : ""}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(e.currentTarget);
          } else if (e.key === "Backspace" && e.currentTarget.value === "" && items.length > 0) {
            onCommit(listFor(type, items.slice(0, -1)));
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.value = "";
            onLeave();
          }
        }}
        onBlur={(e) => {
          if (e.currentTarget.value.trim() !== "") add(e.currentTarget);
        }}
      />
      <datalist id={listId}>
        {suggested.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}
