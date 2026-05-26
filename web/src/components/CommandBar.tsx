import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { SearchHit, TreeData } from "../api/types";
import clsx from "clsx";

interface Props {
  mode: "search" | "switcher" | null;
  onClose: () => void;
  onOpenNote: (path: string) => void;
  tree: TreeData;
}

export function CommandBar({ mode, onClose, onOpenNote, tree }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const noteList = tree.notes;

  useEffect(() => {
    if (mode) {
      setQ("");
      setResults([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [mode]);

  useEffect(() => {
    if (!mode) return;
    if (mode === "switcher") {
      const ql = q.trim().toLowerCase();
      const items = noteList
        .filter((p) => ql === "" || p.toLowerCase().includes(ql))
        .slice(0, 50)
        .map<SearchHit>((p) => ({
          path: p,
          title: p.replace(/\.md$/, "").split("/").pop() ?? p,
          score: 0,
          snippet: p,
          matches: 0,
        }));
      setResults(items);
      setActive(0);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      if (q.trim() === "") {
        setResults([]);
        return;
      }
      try {
        const hits = await api.search(q);
        if (!cancelled) {
          setResults(hits);
          setActive(0);
        }
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, mode, noteList]);

  useEffect(() => {
    if (!mode) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const hit = results[active];
        if (hit) {
          onOpenNote(hit.path);
          onClose();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, results, active, onClose, onOpenNote]);

  if (!mode) return null;

  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className={clsx("cmd-bar", "open")} role="dialog" aria-modal="true">
        <header>
          <input
            ref={inputRef}
            value={q}
            placeholder={mode === "switcher" ? "Quick switch…" : "Search vault…"}
            onChange={(e) => setQ(e.target.value)}
            spellCheck={false}
          />
        </header>
        <div className="results scroll">
          {results.length === 0 ? (
            <div className="empty">{q.trim() === "" ? "Type to search…" : "no matches"}</div>
          ) : (
            results.map((r, i) => (
              <div
                key={r.path}
                className={clsx("result", i === active && "active")}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onOpenNote(r.path);
                  onClose();
                }}
              >
                <div className="ttl">{r.title}</div>
                <div className="meta">{r.path}</div>
                {mode === "search" && r.snippet ? <div className="snip">{r.snippet}</div> : null}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
