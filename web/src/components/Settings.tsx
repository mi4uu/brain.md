import { useEffect, useState } from "react";
import type { Theme } from "../hooks/useTheme";
import { gitApi } from "../api/git";

interface Props {
  onClose: () => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  dailyDir: string;
  setDailyDir: (s: string) => void;
}

export function Settings({ onClose, theme, setTheme, dailyDir, setDailyDir }: Props) {
  const [acEnabled, setAcEnabled] = useState<boolean>(true);
  const [acDebounce, setAcDebounce] = useState<number>(15000);
  const [acError, setAcError] = useState<string | null>(null);
  const [gitEnabled, setGitEnabled] = useState<boolean>(false);

  useEffect(() => {
    void gitApi
      .status()
      .then((s) => {
        setGitEnabled(s.enabled);
        setAcEnabled(s.autocommit.enabled);
        setAcDebounce(s.autocommit.debounceMs);
      })
      .catch(() => {
        setGitEnabled(false);
      });
  }, []);

  const saveAutocommit = async (next: { enabled?: boolean; debounceMs?: number }) => {
    try {
      const res = await gitApi.setAutocommit(next);
      setAcEnabled(res.enabled);
      setAcDebounce(res.debounceMs);
      setAcError(null);
    } catch (e) {
      setAcError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="settings-panel" role="dialog" aria-modal="true">
        <h2>Settings</h2>
        <label>
          <span className="lbl">Theme</span>
          <select
            className="input"
            value={theme}
            onChange={(e) => setTheme(e.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          <span className="lbl">Daily notes folder</span>
          <input
            className="input"
            value={dailyDir}
            onChange={(e) => setDailyDir(e.target.value)}
            placeholder="Journal"
          />
        </label>

        <fieldset
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-2)",
            padding: "12px 16px",
            margin: "16px 0 8px",
          }}
        >
          <legend
            style={{
              padding: "0 6px",
              color: "var(--text-3)",
              fontSize: "var(--text-sm)",
            }}
          >
            Git history
          </legend>
          {!gitEnabled ? (
            <p className="muted" style={{ fontSize: "var(--text-sm)" }}>
              Git not initialised in vault. Restart server with{" "}
              <code>GIT_AUTOCOMMIT=1</code> to enable.
            </p>
          ) : (
            <>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={acEnabled}
                  onChange={(e) => void saveAutocommit({ enabled: e.target.checked })}
                />
                <span>Autocommit changes</span>
              </label>
              <label>
                <span className="lbl">Debounce (ms)</span>
                <input
                  className="input"
                  type="number"
                  min={500}
                  step={500}
                  value={acDebounce}
                  onChange={(e) => setAcDebounce(Number(e.target.value))}
                  onBlur={() => void saveAutocommit({ debounceMs: acDebounce })}
                />
              </label>
              {acError ? (
                <p style={{ color: "var(--callout-danger)", fontSize: "var(--text-sm)" }}>
                  {acError}
                </p>
              ) : null}
            </>
          )}
        </fieldset>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
