import { useEffect, useRef, useState, type RefObject } from "react";
import { ImageIcon } from "@radix-ui/react-icons";
import { api } from "../api/client";
import { CellValue } from "./CellValue";
import { RowMenu } from "./RowMenu";
import { createQueue } from "./media-queue";
import { coverSource } from "./model";
import type { LayoutProps, Row } from "./types";

const enqueueMedia = createQueue(4);

// Resolves true once the element is near the viewport (at once without the API).
function useNearViewport(): [RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near];
}

// A plain <img> load carries no bearer token, so with auth on it would 401.
// Fetch the bytes through the app's patched fetch and show a blob URL, only
// near the viewport and at most a few at a time.
function MediaImg({ path }: { path: string }) {
  const [ref, near] = useNearViewport();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!near) return;
    const ctl = new AbortController();
    let made: string | null = null;
    const cancel = enqueueMedia(async () => {
      const r = await fetch(api.mediaUrl(path), { signal: ctl.signal });
      if (!r.ok) return;
      const b = await r.blob();
      if (ctl.signal.aborted) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      cancel();
      ctl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [path, near]);
  return (
    <div ref={ref} className="base-cover-media">
      {url ? <img src={url} alt="" /> : <CoverPlaceholder />}
    </div>
  );
}

function CoverPlaceholder() {
  return (
    <div className="base-cover-ph">
      <ImageIcon aria-hidden />
    </div>
  );
}

function ExternalImg({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <CoverPlaceholder />;
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
