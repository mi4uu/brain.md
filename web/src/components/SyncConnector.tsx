import { useEffect, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";

interface Props {
  mainRef: React.RefObject<HTMLElement | null>;
  editorViewRef: React.MutableRefObject<EditorView | null>;
  /** changes whenever a redraw might be needed (cursor move, content change, etc.) */
  trigger: unknown;
  hidden?: boolean;
}

interface PathData {
  d: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
  height: number;
}

export function SyncConnector({ mainRef, editorViewRef, trigger, hidden }: Props) {
  const [data, setData] = useState<PathData | null>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (hidden) {
      setData(null);
      return;
    }
    const mainEl = mainRef.current;
    if (!mainEl) return;

    const compute = () => {
      const v = editorViewRef.current;
      if (!v) {
        setData(null);
        return;
      }
      const mainRect = mainEl.getBoundingClientRect();
      const editorPane = mainEl.querySelector<HTMLElement>(".editor-pane");
      const previewPane = mainEl.querySelector<HTMLElement>(".preview-pane");
      if (!editorPane || !previewPane) {
        setData(null);
        return;
      }
      const editorRect = editorPane.getBoundingClientRect();
      const previewRect = previewPane.getBoundingClientRect();

      const head = v.state.selection.main.head;
      const c = v.coordsAtPos(head);
      if (!c) {
        setData(null);
        return;
      }
      const ay = (c.top + c.bottom) / 2 - mainRect.top;
      const ax = editorRect.right - mainRect.left;

      const active = mainEl.querySelector<HTMLElement>(".preview .doc .active-block");
      if (!active) {
        setData(null);
        return;
      }
      const blockRect = active.getBoundingClientRect();
      const by = (blockRect.top + blockRect.bottom) / 2 - mainRect.top;
      const bx = previewRect.left - mainRect.left;

      // off-pane visibility check
      const aVisible =
        ay >= editorRect.top - mainRect.top &&
        ay <= editorRect.bottom - mainRect.top;
      const bVisible =
        by >= previewRect.top - mainRect.top &&
        by <= previewRect.bottom - mainRect.top;
      if (!aVisible || !bVisible) {
        setData(null);
        return;
      }

      const gap = Math.max(bx - ax, 1);
      const cx1 = ax + gap / 2;
      const cx2 = bx - gap / 2;
      const d = `M ${ax} ${ay} C ${cx1} ${ay}, ${cx2} ${by}, ${bx} ${by}`;
      setData({
        d,
        ax,
        ay,
        bx,
        by,
        width: mainRect.width,
        height: mainRect.height,
      });
    };

    const schedule = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(compute);
    };

    schedule();

    const editorScroll = editorViewRef.current?.scrollDOM;
    const previewScroll = mainEl.querySelector<HTMLElement>(".preview");
    editorScroll?.addEventListener("scroll", schedule, { passive: true });
    previewScroll?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    const ro = new ResizeObserver(schedule);
    ro.observe(mainEl);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      editorScroll?.removeEventListener("scroll", schedule);
      previewScroll?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [mainRef, editorViewRef, trigger, hidden]);

  if (!data || hidden) return null;
  return (
    <svg
      className="sync-connector"
      width={data.width}
      height={data.height}
      viewBox={`0 0 ${data.width} ${data.height}`}
      aria-hidden="true"
    >
      <path d={data.d} />
      <circle cx={data.ax} cy={data.ay} r={3} />
      <circle cx={data.bx} cy={data.by} r={3} />
    </svg>
  );
}
