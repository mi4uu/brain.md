import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderMarkdown, isMediaName } from "../renderer/render";
import { api } from "../api/client";
import { getToken } from "../auth/token";
import { TableTools } from "./TableTools";
import type { LineRange, MdTable } from "../tables/md-table";
import { BaseView } from "../bases/BaseView";
import { isLiveFence, keepRoot } from "../bases/edit";
import type { BaseHost } from "../bases/host";

const PROTECTED_MEDIA_SELECTOR =
  'img[src^="/api/media-raw/"]:not([data-blob-protected]), video[src^="/api/media-raw/"]:not([data-blob-protected]), audio[src^="/api/media-raw/"]:not([data-blob-protected]), source[src^="/api/media-raw/"]:not([data-blob-protected])';

// Browser-issued element requests (img/video/audio/source) don't go through
// the patched fetch that attaches the bearer token, so with auth enabled
// they 401. Fetch each one through the patched fetch instead and point the
// element at a blob object URL. Created URLs are tracked in `store` so the
// caller can revoke them once the content they belong to is gone.
async function protectMedia(
  container: HTMLElement,
  isCancelled: () => boolean,
  store: { current: string[] },
): Promise<void> {
  const els = container.querySelectorAll<HTMLImageElement | HTMLMediaElement>(
    PROTECTED_MEDIA_SELECTOR,
  );
  for (const el of Array.from(els)) {
    if (isCancelled()) return;
    el.setAttribute("data-blob-protected", "");
    const original = el.getAttribute("src");
    if (!original) continue;
    try {
      const res = await fetch(original);
      if (!res.ok || isCancelled()) continue;
      const blob = await res.blob();
      if (isCancelled()) return;
      const url = URL.createObjectURL(blob);
      store.current.push(url);
      el.setAttribute("src", url);
    } catch {
      // leave the original src; the element 401s and shows broken, same as
      // before this fix, instead of leaving the whole preview stuck
    }
  }
}

interface PreviewProps {
  content: string;
  notePath: string | null;
  // Rendered at the top of the document, above the note body.
  header?: ReactNode;
  resolveByBasename: (name: string, fromPath?: string) => string | null;
  onOpenNote: (path: string) => void;
  // A [[link]] whose target doesn't exist yet.
  onMissingNote?: (target: string) => void;
  onOpenTag: (tag: string) => void;
  onScrollLine?: (line: number) => void;
  onSelectLine?: (line: number) => void;
  onEditTable?: (range: LineRange, fn: (t: MdTable) => MdTable) => boolean;
  baseHost?: BaseHost;
}

interface BaseRoot {
  el: HTMLElement;
  root: Root;
  source: string;
  rendered: { source: string; startLine: number; notePath: string | null; host: BaseHost } | null;
  // Scroll offsets inside the view (table wrap, kanban board). A detached
  // element loses them, so they are put back after each move.
  scroll: Map<HTMLElement, { top: number; left: number }>;
}

function newBaseRoot(el: HTMLElement, source: string): BaseRoot {
  const scroll = new Map<HTMLElement, { top: number; left: number }>();
  el.addEventListener(
    "scroll",
    (e) => {
      const t = e.target;
      if (t instanceof HTMLElement && t !== el) scroll.set(t, { top: t.scrollTop, left: t.scrollLeft });
    },
    { capture: true, passive: true },
  );
  return { el, root: createRoot(el), source, rendered: null, scroll };
}

function restoreScroll(entry: BaseRoot): void {
  for (const [t, pos] of entry.scroll) {
    if (!entry.el.contains(t)) {
      entry.scroll.delete(t);
      continue;
    }
    t.scrollTop = pos.top;
    t.scrollLeft = pos.left;
  }
}

export interface PreviewHandle {
  scrollToLine: (line: number, opts?: { behavior?: ScrollBehavior; anchorY?: number }) => void;
  setActiveLine: (line: number) => void;
}

export const Preview = forwardRef<PreviewHandle, PreviewProps>(function Preview(
  { content, notePath, header, resolveByBasename, onOpenNote, onMissingNote, onOpenTag, onScrollLine, onSelectLine, onEditTable, baseHost },
  forwardedRef,
) {
  const ref = useRef<HTMLDivElement | null>(null);
  const docRef = useRef<HTMLDivElement | null>(null);
  const blocksRef = useRef<Array<{ line: number; el: HTMLElement }>>([]);
  const activeLineRef = useRef<number>(-1);
  const suppressScrollRef = useRef<number>(0);
  const mediaBlobUrlsRef = useRef<string[]>([]);
  const baseRootsRef = useRef(new Map<number, BaseRoot>());
  const baseAliveRef = useRef(false);

  const { html } = useMemo(() => {
    const dirOf = notePath ? notePath.replace(/[^/]+$/, "") : "";
    return renderMarkdown(content, {
      resolveWikilink: (target) => resolveByBasename(target),
      currentPath: notePath ?? undefined,
      isMediaTarget: (target) => isMediaName(target),
      buildMediaUrl: (target) =>
        api.mediaUrl(`${dirOf}.media/${target.split("/").pop()}`),
    });
  }, [content, notePath, resolveByBasename]);

  // protected media: with auth on, img/video/audio/source elements need a
  // blob URL fetched through the patched fetch (see protectMedia above).
  // Embeds load asynchronously and reuse mediaBlobUrlsRef too, so the
  // revoke has to happen on cleanup (next html change or unmount), not up
  // front, or it would race ahead of urls that effect hasn't created yet.
  useEffect(() => {
    const root = ref.current;
    let cancelled = false;
    if (root && getToken()) {
      void protectMedia(root, () => cancelled, mediaBlobUrlsRef);
    }
    return () => {
      cancelled = true;
      for (const url of mediaBlobUrlsRef.current) URL.revokeObjectURL(url);
      mediaBlobUrlsRef.current = [];
    };
  }, [html]);

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
      if ((e.target as HTMLElement | null)?.closest?.(".base-view")) return;
      // The Properties panel is the header. Its clicks are its own: canceling
      // one would fight its checkboxes, and none of them is a cursor move.
      if ((e.target as Element).closest?.(".props-panel")) return;
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
              else if (wl && onMissingNote) onMissingNote(wl);
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
      // TableTools claims the clicks it turns into a cell edit.
      if (e.defaultPrevented) return;
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
  }, [onOpenNote, onMissingNote, onOpenTag, onSelectLine, html]);

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
            resolveWikilink: (t) => resolveByBasename(t, target),
            isMediaTarget: (t) => isMediaName(t),
            buildMediaUrl: (t) =>
              api.mediaUrl(`${dirOf}.media/${t.split("/").pop()}`),
            baseViews: false,
          });
          const body = el.querySelector(".embed-body");
          if (body) {
            body.innerHTML = inner.html;
            if (getToken()) void protectMedia(body as HTMLElement, () => cancelled, mediaBlobUrlsRef);
          }
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
          el.innerHTML = `<pre class="mermaid-error">${escapeHtml(String(err))}</pre>`;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [html]);

  // ```base blocks: a live view in each placeholder. The HTML is replaced on
  // every change, so the root of each block is kept by ordinal and moved into
  // the new placeholder (see keepRoot); typing elsewhere in the note and the
  // view's own fence edits do not remount it. A layout effect, so it runs
  // before the passive block collector above, which then sees the moved-in
  // elements.
  // biome-ignore lint/correctness/useExhaustiveDependencies: html is the trigger, the placeholders were replaced
  useLayoutEffect(() => {
    const prev = baseRootsRef.current;
    const next = new Map<number, BaseRoot>();
    const root = ref.current;
    if (root && baseHost) {
      const holders = Array.from(root.querySelectorAll<HTMLElement>(".base-block[data-base]"))
        .filter((el) => !el.closest(".embed-body"))
        .map((el) => ({ el, source: el.getAttribute("data-base") ?? "", startLine: Number(el.getAttribute("data-source-line")) }))
        .filter((h) => isLiveFence(content, h.startLine, h.source));
      const sameCount = holders.length === prev.size;
      for (const [n, { el: holder, source, startLine }] of holders.entries()) {
        const old = prev.get(n);
        let entry: BaseRoot;
        if (old && keepRoot(old.source, source, sameCount)) {
          if (old.el !== holder) {
            for (const name of ["data-base", "data-source-line", "data-source-end"]) {
              const v = holder.getAttribute(name);
              if (v === null) old.el.removeAttribute(name);
              else old.el.setAttribute(name, v);
            }
            holder.replaceWith(old.el);
            restoreScroll(old);
          }
          entry = old;
          entry.source = source;
        } else {
          entry = newBaseRoot(holder, source);
        }
        const r = entry.rendered;
        if (!r || r.source !== source || r.startLine !== startLine || r.notePath !== notePath || r.host !== baseHost) {
          entry.rendered = { source, startLine, notePath, host: baseHost };
          entry.root.render(<BaseView key={notePath ?? ""} source={source} startLine={startLine} ordinal={n} notePath={notePath} host={baseHost} />);
        }
        next.set(n, entry);
      }
    }
    baseRootsRef.current = next;
    const reused = new Set(next.values());
    const stale = [...prev.values()].filter((e) => !reused.has(e));
    // React refuses a synchronous unmount while it is rendering.
    if (stale.length > 0) queueMicrotask(() => {
      for (const e of stale) e.root.unmount();
    });
  }, [html, content, notePath, baseHost]);

  // StrictMode runs cleanup and setup back to back; the flag turns that into a
  // reuse, and only a real unmount drops the roots.
  useEffect(() => {
    baseAliveRef.current = true;
    return () => {
      baseAliveRef.current = false;
      queueMicrotask(() => {
        if (baseAliveRef.current) return;
        for (const e of baseRootsRef.current.values()) e.root.unmount();
        baseRootsRef.current = new Map();
      });
    };
  }, []);

  const docEl = (
    <div className="doc" ref={docRef}>
      {header}
      {content.trim() === "" ? (
        notePath ? <p className="muted">Empty note</p> : null
      ) : (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown runs hast-util-sanitize with previewSchema
        <div dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );

  return (
    <div className="preview scroll" ref={ref}>
      {onEditTable ? (
        <TableTools scrollerRef={ref} docRef={docRef} content={content} html={html} onEditTable={onEditTable} noteKey={notePath}>
          {docEl}
        </TableTools>
      ) : (
        docEl
      )}
    </div>
  );
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
