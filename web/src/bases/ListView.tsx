import { CellValue } from "./CellValue";
import type { LayoutProps } from "./types";

export function ListView({ result, host }: LayoutProps) {
  const cols = result.columns.filter((c) => c.key !== "file.name");
  const grouped = result.groups.some((g) => g.label !== "");
  return (
    <div className="base-list-wrap">
      {result.groups.map((g) => (
        <section key={g.key ?? "\u0000none"}>
          {grouped ? (
            <h4 className="base-group-title">
              {g.label} <span className="base-count">{g.count}</span>
            </h4>
          ) : null}
          <ul className="base-list">
            {g.rows.map((r) => (
              <li key={r.path}>
                <button type="button" className="base-link" onClick={() => host.openNote(r.path)}>
                  {r.title || r.path}
                </button>
                <span className="base-list-meta">
                  {cols.map((c) => {
                    const v = r.values[c.key] ?? null;
                    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                    return (
                      <span key={c.key} className="base-list-prop">
                        <span className="sr-only">{c.label}: </span>
                        <CellValue col={c} value={v} row={r} host={host} />
                      </span>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
