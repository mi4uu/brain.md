import { useEffect, useRef, useState } from "react";

type Status = "saved" | "dirty" | "saving" | "error";

export function useDebouncedSave(
  content: string,
  path: string | null,
  save: (path: string, content: string) => Promise<void>,
  delay = 500,
): { status: Status; flush: () => Promise<void> } {
  const [status, setStatus] = useState<Status>("saved");
  const latest = useRef(content);
  const lastSaved = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const pathRef = useRef<string | null>(path);

  useEffect(() => {
    latest.current = content;
    pathRef.current = path;
    if (path === null) return;
    if (lastSaved.current === content) {
      setStatus("saved");
      return;
    }
    setStatus("dirty");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void flushInternal();
    }, delay);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, path, delay]);

  // path change resets baseline
  useEffect(() => {
    lastSaved.current = content;
    setStatus("saved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  async function flushInternal() {
    const p = pathRef.current;
    if (p === null) return;
    const c = latest.current;
    setStatus("saving");
    try {
      await save(p, c);
      lastSaved.current = c;
      if (latest.current === c) setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return { status, flush: flushInternal };
}
