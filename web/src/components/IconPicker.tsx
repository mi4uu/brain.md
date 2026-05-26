import { useState } from "react";
import { ICONS, IconBare } from "./FolderIconCatalog";

interface Props {
  folderPath: string;
  currentIcon: string | null;
  onSave: (icon: string | null) => void;
  onClose: () => void;
}

export function IconPicker({ folderPath, currentIcon, onSave, onClose }: Props) {
  const [emoji, setEmoji] = useState(
    currentIcon?.startsWith("emoji:") ? currentIcon.slice(6) : "",
  );

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        style={{ width: "min(560px, calc(100vw - 32px))" }}
      >
        <h2 style={{ marginBottom: 4 }}>Folder icon</h2>
        <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: "var(--text-sm)" }}>
          {folderPath}
        </p>

        <div className="icon-grid">
          {ICONS.map((it) => (
            <button
              key={it.key}
              className={`icon-cell${currentIcon === it.key ? " active" : ""}`}
              title={it.label}
              onClick={() => onSave(it.key)}
            >
              <IconBare iconKey={it.key} size={22} />
            </button>
          ))}
        </div>

        <fieldset
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-2)",
            padding: "12px 16px",
            marginTop: 16,
          }}
        >
          <legend style={{ padding: "0 6px", color: "var(--text-3)", fontSize: "var(--text-sm)" }}>
            Custom emoji
          </legend>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              className="input"
              maxLength={4}
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              placeholder="📓"
              style={{ width: 90, fontSize: "var(--text-md)", textAlign: "center" }}
            />
            <button
              className="btn primary"
              disabled={emoji.trim() === ""}
              onClick={() => onSave(`emoji:${emoji.trim()}`)}
            >
              Use emoji
            </button>
          </div>
        </fieldset>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
          <button className="btn" onClick={() => onSave(null)}>
            Reset to default
          </button>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}
