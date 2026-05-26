import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { renderMarkdown, isMediaName } from "../renderer/render";
import { api } from "../api/client";

interface PreviewProps {
  content: string;
  notePath: string | null;
  resolveByBasename: (name: string) => string | null;
  onOpenNote: (path: string) => void;
  onOpenTag: (tag: string) => void;
  onScrollLine?: (line: number) => void;
  onSelectLine?: (line: number) => void;
}

export interface PreviewHandle {
  scrollToLine: (line: number, opts?: { behavior?: ScrollBehavior; anchorY?: number }) => void;
  setActiveLine: (line: number) => void;
}

export const Preview = forwardRef<PreviewHandle, PreviewProps>(function Preview(
  { content, notePath, resolveByBasename, onOpenNote, onOpenTag, onScrollLine, onSelectLine },
  forwardedRef,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef<Array<{ line: number; el: HTMLElement }>>([]);
  const activeLineRef = useRef<number>(-1);
  const suppressScrollRef = useRef<number>(0);

  const { html, frontmatter, frontmatterError } = useMemo(() => {
    const dirOf = notePath ? notePath.replace(/[^/]+$/, "") : "";
    return renderMarkdown(content, {
      resolveWikilink: (target) => resolveByBasename(target),
      isMediaTarget: (target) => isMediaName(target),
      buildMediaUrl: (target) =>
        api.mediaUrl(`${dirOf}.media/${target.split("/").pop()}`),
    });
  }, [content, notePath, resolveByBasename]);

  // collect blocks after each render
  useEffect(() => {
    const doc = docRef.current;
    if (!doc) {
      blocksRef.current = [];
      return;
    }
    const nodes = doc.querySelectorAll<HTMLElement>("[data-source-line]");
    const items: Array<{ line: number; el: HTMLElement }> = [];
    for (const el of Array.from(nodes)) {
      const n = Number(el.getAttribute("data-source-line"));
      if (Number.isFinite(n)) items.push({ line: n, el });
    }
    items.sort((a, b) => a.line - b.line);
    blocksRef.current = items;
    applyActive(activeLineRef.current);
  }, [html]);

  function applyActive(line: number) {
    const items = blocksRef.current;
    if (items.length === 0) return;
    let activeIdx = -1;
    for (let i = 0; i < items.length; i++) {
      if ((items[i]?.line ?? 0) <= line) activeIdx = i;
      else break;
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      if (i === activeIdx) it.el.classList.add("active-block");
      else it.el.classList.remove("active-block");
    }
  }

  function blockTopWithinContainer(el: HTMLElement, container: HTMLElement): number {
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    return container.scrollTop + (eRect.top - cRect.top);
  }

  useImperativeHandle(forwardedRef, () => ({
    scrollToLine(line, opts) {
      const container = ref.current;
      const items = blocksRef.current;
      if (!container || items.length === 0) return;
      let target = items[0]!;
      for (const it of items) {
        if (it.line <= line) target = it;
        else break;
      }
      const blockTop = blockTopWithinContainer(target.el, container);
      const anchorY = opts?.anchorY ?? 24;
      const top = blockTop - anchorY;
      suppressScrollRef.current = Date.now() + 220;
      container.scrollTo({
        top: Math.max(0, top),
        behavior: opts?.behavior ?? "auto",
      });
    },
    setActiveLine(line) {
      activeLineRef.current = line;
      applyActive(line);
    },
  }));

  // scroll listener (only fires when not programmatic)
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    let raf = 0;
    function onScroll() {
      if (Date.now() < suppressScrollRef.current) return;
      const cb = onScrollLine;
      if (!cb || !container) return;
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const items = blocksRef.current;
        if (!container || items.length === 0) return;
        const probe = container.scrollTop + 24;
        let line = items[0]!.line;
        for (const it of items) {
          const top = blockTopWithinContainer(it.el, container);
          if (top <= probe) line = it.line;
          else break;
        }
        cb(line);
      });
    }
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [onScrollLine]);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const handler = (e: MouseEvent) => {
      let el = e.target as HTMLElement | null;
      while (el && el !== root) {
        if (el.tagName === "A") {
          const a = el as HTMLAnchorElement;
          const wl = a.getAttribute("data-wikilink");
          if (wl !== null) {
            e.preventDefault();
            const href = a.getAttribute("href") ?? "";
            if (href.startsWith("#/note/")) {
              if (window.location.hash === href) {
                // re-trigger by clearing first
                window.location.hash = "";
                setTimeout(() => (window.location.hash = href), 0);
              } else {
                window.location.hash = href;
              }
            } else {
              const resolved = a.getAttribute("data-resolved");
              if (resolved) onOpenNote(resolved);
            }
            return;
          }
          const tag = a.getAttribute("data-tag");
          if (tag !== null) {
            e.preventDefault();
            onOpenTag(tag);
            return;
          }
          const href = a.getAttribute("href") ?? "";
          if (href.startsWith("#/note/")) {
            e.preventDefault();
            if (window.location.hash === href) {
              window.location.hash = "";
              setTimeout(() => (window.location.hash = href), 0);
            } else {
              window.location.hash = href;
            }
            return;
          }
          if (href.startsWith("#/tag/")) {
            e.preventDefault();
            onOpenTag(decodeURIComponent(href.slice("#/tag/".length)));
            return;
          }
        }
        if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "checkbox") {
          e.preventDefault();
          return;
        }
        el = el.parentElement;
      }
      // embed collapse toggle (chevron in embed header)
      let chev = e.target as HTMLElement | null;
      while (chev && chev !== root) {
        if (chev.classList?.contains("embed-toggle")) {
          e.preventDefault();
          e.stopPropagation();
          const note = chev.closest(".embed-note");
          if (note) note.classList.toggle("collapsed");
          return;
        }
        chev = chev.parentElement;
      }
      // clicks inside embed body never move parent editor cursor
      let inEmbed = e.target as HTMLElement | null;
      while (inEmbed && inEmbed !== root) {
        if (inEmbed.classList?.contains("embed-body")) return;
        inEmbed = inEmbed.parentElement;
      }
      // climb again — no link/tag/checkbox hit → find nearest [data-source-line]
      if (!onSelectLine) return;
      let block = e.target as HTMLElement | null;
      while (block && block !== root) {
        const ds = block.getAttribute?.("data-source-line");
        if (ds) {
          const n = Number(ds);
          if (Number.isFinite(n)) {
            // skip if user is selecting text
            const sel = window.getSelection();
            if (sel && !sel.isCollapsed) return;
            onSelectLine(n);
          }
          return;
        }
        block = block.parentElement;
      }
    };
    root.addEventListener("click", handler);
    return () => root.removeEventListener("click", handler);
  }, [onOpenNote, onOpenTag, onSelectLine, html]);

  // note transclusion: fill .embed-note bodies w/ rendered content of target note
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const embeds = Array.from(
      root.querySelectorAll<HTMLElement>(".embed-note[data-embed-path]"),
    ).filter((el) => (el.getAttribute("data-embed-path") ?? "") !== "");
    if (embeds.length === 0) return;
    let cancelled = false;
    void (async () => {
      const visited = new Set<string>();
      if (notePath) visited.add(notePath);
      for (const el of embeds) {
        if (cancelled) break;
        const target = el.getAttribute("data-embed-path") ?? "";
        if (!target || visited.has(target)) {
          const body = el.querySelector(".embed-body");
          if (body) body.textContent = visited.has(target) ? "(recursive embed)" : "Not found.";
          continue;
        }
        visited.add(target);
        try {
          const data = await api.readNote(target);
          if (cancelled) break;
          const dirOf = target.replace(/[^/]+$/, "");
          const inner = renderMarkdown(data.content, {
            resolveWikilink: (t) => resolveByBasename(t),
            isMediaTarget: (t) => isMediaName(t),
            buildMediaUrl: (t) =>
              api.mediaUrl(`${dirOf}.media/${t.split("/").pop()}`),
          });
          const body = el.querySelector(".embed-body");
          if (body) body.innerHTML = inner.html;
        } catch {
          const body = el.querySelector(".embed-body");
          if (body) body.textContent = "Could not load.";
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html, notePath, resolveByBasename]);

  // mermaid lazy render
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const blocks = root.querySelectorAll<HTMLElement>(".mermaid-block[data-mermaid]");
    if (blocks.length === 0) return;
    let cancelled = false;
    void (async () => {
      const { default: mermaid } = await import("mermaid");
      mermaid.initialize({
        startOnLoad: false,
        theme: document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "default",
        securityLevel: "loose",
      });
      let n = 0;
      for (const el of Array.from(blocks)) {
        if (cancelled) break;
        const src = el.getAttribute("data-mermaid") ?? "";
        if (!src.trim()) continue;
        try {
          const id = `m-${Date.now()}-${n++}`;
          const { svg } = await mermaid.render(id, src);
          if (cancelled) break;
          el.innerHTML = svg;
        } catch (err) {
          el.innerHTML = `<pre class="mermaid-error">${escape(String(err))}</pre>`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div className="preview scroll" ref={ref}>
      <div className="doc" ref={docRef}>
        {frontmatterError ? (
          <div className="frontmatter-error">frontmatter: {frontmatterError}</div>
        ) : null}
        {frontmatter && Object.keys(frontmatter).length > 0 ? (
          <PropsRender data={frontmatter} />
        ) : null}
        {content.trim() === "" ? (
          <p className="muted">empty note</p>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
});

function PropsRender({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="props">
      {Object.entries(data).map(([k, v]) => (
        <div className="props-row" key={k}>
          <span className="k">{k}</span>
          <span className="v">{formatValue(v)}</span>
        </div>
      ))}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.map((x) => formatValue(x)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
