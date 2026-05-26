import { useEffect, useRef, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = Math.max(0, rect.right - window.innerWidth + 8);
    const dy = Math.max(0, rect.bottom - window.innerHeight + 8);
    if (dx || dy) {
      el.style.left = `${x - dx}px`;
      el.style.top = `${y - dy}px`;
    }
  }, [x, y]);

  return (
    <div ref={ref} className="ctx-menu" style={{ left: x, top: y }} role="menu">
      {items.map((it, i) => (
        <button
          key={i}
          className={`ctx-item${it.destructive ? " destructive" : ""}`}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.onClick();
          }}
          role="menuitem"
        >
          {it.icon ? <span className="ctx-icon">{it.icon}</span> : null}
          <span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
