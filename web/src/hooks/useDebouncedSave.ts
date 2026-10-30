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
  // Chains every flush (debounce-triggered or explicit) onto the previous
  // one so two saves for the same note are never in flight at once. Each
  // link reads `latest.current` only once it actually runs, so the last
  // queued flush always sends the newest content rather than racing an
  // earlier one to the server.
  const chain = useRef<Promise<void>>(Promise.resolve());

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
      flushInternal().catch(() => {
        // status already reflects the failure; caller sees it via `status`
        // or by awaiting their own explicit flush()
      });
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

  function flushInternal(): Promise<void> {
    const run = async () => {
      const p = pathRef.current;
      if (p === null) return;
      const c = latest.current;
      if (lastSaved.current === c) {
        setStatus("saved");
        return;
      }
      setStatus("saving");
      try {
        await save(p, c);
        lastSaved.current = c;
        if (latest.current === c) setStatus("saved");
      } catch (e) {
        // Leave `latest`/`lastSaved` untouched: the buffer the caller holds
        // is still the unsaved edit, not something to discard or overwrite.
        setStatus("error");
        throw e;
      }
    };
    const next = chain.current.catch(() => {}).then(run);
    chain.current = next;
    return next;
  }

  return { status, flush: flushInternal };
}
