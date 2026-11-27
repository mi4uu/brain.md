import { useEffect, useState } from "react";
import { api } from "../api/client";
import { CellValue } from "./CellValue";
import { RowMenu } from "./RowMenu";
import { coverSource } from "./model";
import type { LayoutProps, Row } from "./types";

// A plain <img> load carries no bearer token, so with auth on it would 401.
// Fetch the bytes through the app's patched fetch and show a blob URL.
function MediaImg({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    fetch(api.mediaUrl(path))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return url ? <img src={url} alt="" loading="lazy" /> : <div className="base-cover-ph" />;
}

function ExternalImg({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="base-cover-ph" />;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function Cover({ row, value }: { row: Row; value: Row["values"][string] | undefined }) {
  const src = value === undefined ? null : coverSource(row.path, value);
  if (!src) return null;
  return <div className="base-cover">{"external" in src ? <ExternalImg src={src.external} /> : <MediaImg path={src.media} />}</div>;
}

export function CardsView({ result, view, host }: LayoutProps) {
  const cols = result.columns.filter((c) => c.key !== "file.name" && c.key !== view.image);
  const grouped = result.groups.some((g) => g.label !== "");
  return (
    <div className="base-cards-wrap">
      {result.groups.map((g) => (
        <section key={g.key ?? "\u0000none"}>
          {grouped ? (
            <h4 className="base-group-title">
              {g.label} <span className="base-count">{g.count}</span>
            </h4>
          ) : null}
          <div className="base-cards">
            {g.rows.map((r) => (
              <article className="base-card" key={r.path}>
                {view.image ? <Cover row={r} value={r.values[view.image]} /> : null}
                <div className="base-card-head">
                  <button type="button" className="base-link base-card-title" onClick={() => host.openNote(r.path)}>
                    {r.title || r.path}
                  </button>
                  <RowMenu row={r} host={host} />
                </div>
                <dl className="base-card-props">
                  {cols.map((c) => {
                    const v = r.values[c.key] ?? null;
                    if (v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                    return (
                      <div key={c.key}>
                        <dt>{c.label}</dt>
                        <dd>
                          <CellValue col={c} value={v} row={r} host={host} />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
