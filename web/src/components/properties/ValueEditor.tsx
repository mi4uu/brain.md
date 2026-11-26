import { useEffect, useId, useRef } from "react";
import type { PropValue } from "@brainmd/shared/frontmatter";
import {
  addChip,
  chipsOf,
  fitsType,
  isListType,
  nativeDate,
  nativeDateTime,
  parseNumber,
  dateCommit,
  numberCommit,
  removeChip,
  textOf,
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

  if (row.nested || !fitsType(type, value)) {
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
      <label className="prop-check-hit">
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
      </label>
    );
  }

  if (isListType(type)) {
    return (
      <Chips
        name={row.name}
        type={type}
        value={value}
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
        <DateInput
          name={row.name}
          kind={type === "date" ? "date" : "datetime-local"}
          native={native}
          onCommit={onCommit}
          onLeave={onLeave}
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

function DateInput({
  name,
  kind,
  native,
  onCommit,
  onLeave,
}: {
  name: string;
  kind: "date" | "datetime-local";
  native: string;
  onCommit: (value: PropValue) => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Uncontrolled so a half-typed date survives re-renders, but an edit made
  // elsewhere (source, undo) must reach the input, or the next blur writes the
  // stale value back. Remounting on change would drop focus.
  useEffect(() => {
    const el = ref.current;
    if (el && el !== document.activeElement) el.value = native;
  }, [native]);
  return (
    <input
      ref={ref}
      data-prop-value
      className="prop-input prop-mono"
      type={kind}
      aria-label={name}
      defaultValue={native}
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

function Chips({
  name,
  type,
  value,
  suggestions,
  onCommit,
  onLeave,
}: {
  name: string;
  type: PropRow["type"];
  value: PropValue;
  suggestions: PropValue[];
  onCommit: (value: PropValue) => void;
  onLeave: () => void;
}) {
  const listId = useId();
  const chips = chipsOf(value);
  const labels = chips.map((c) => c.label);
  const suggested = suggestions
    .filter((s): s is string => typeof s === "string" && !labels.includes(s))
    .slice(0, 20);

  const add = (input: HTMLInputElement) => {
    const next = addChip(type, value, input.value);
    input.value = "";
    if (next) onCommit(next);
  };

  return (
    <div className="prop-chips">
      {chips.map(({ label, index }) => (
        <span className="prop-chip" key={index}>
          {label}
          <button
            type="button"
            className="prop-chip-x"
            aria-label={`Remove ${label}`}
            onClick={() => onCommit(removeChip(value, index))}
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
        placeholder={chips.length === 0 ? "Add" : ""}
        spellCheck={false}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(e.currentTarget);
          } else if (e.key === "Backspace" && !e.repeat && e.currentTarget.value === "" && chips.length > 0) {
            onCommit(removeChip(value, chips[chips.length - 1]!.index));
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
