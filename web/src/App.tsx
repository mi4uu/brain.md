import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { EditorView } from "@codemirror/view";
import { api } from "./api/client";
import type { Backlink, TreeData } from "./api/types";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { Preview, type PreviewHandle } from "./components/Preview";
import { Backlinks } from "./components/Backlinks";
import { CommandBar } from "./components/CommandBar";
import { Outline } from "./components/Outline";
import { Settings } from "./components/Settings";
import { TasksView } from "./components/TasksView";
import { TrashView } from "./components/TrashView";
import { EditorToolbar } from "./components/EditorToolbar";
import { HistoryPanel } from "./components/HistoryPanel";
import { IconPicker } from "./components/IconPicker";
import { SyncConnector } from "./components/SyncConnector";
import { gitApi, type GitStatus } from "./api/git";
import { metaApi, type FolderMeta } from "./api/meta";
import {
  MenuIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  StarIcon,
  SunIcon,
  CalendarIcon,
  EyeIcon,
  PenIcon,
  TagIcon,
  CheckSquareIcon,
  TrashIcon,
  HistoryIcon,
  GitCommitIcon,
  FlagIcon,
  FilePlusIcon,
  FolderPlusIcon,
} from "./components/Icons";
import { useTheme } from "./hooks/useTheme";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { settingsApi, type AppSettings } from "./api/settings";
import { useDebouncedSave } from "./hooks/useDebouncedSave";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/toaster";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs";
import "./styles/tw.css";
import "./styles/tokens.css";
import "./styles/global.css";
import "./styles/layout.css";
import "./styles/tree.css";
import "./styles/editor.css";
import "./styles/preview.css";
import "./styles/panels.css";
import "./styles/toolbar.css";
import "./styles/history.css";
import "./styles/hljs.css";
import "katex/dist/katex.min.css";

export function App() {
  const { theme, setTheme, resolved } = useTheme();
  const isMobile = useMediaQuery("(max-width: 840px)");
  const [tree, setTree] = useState<TreeData>({ folders: [], notes: [] });
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit");
  const [cmd, setCmd] = useState<"search" | "switcher" | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    version: 1,
    bookmarks: [],
    dailyDir: "Journal",
    git: { autocommit: true, debounceMs: 15000 },
  });
  const bookmarks = settings.bookmarks;
  const dailyDir = settings.dailyDir;
  const [showSettings, setShowSettings] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [folderMeta, setFolderMeta] = useState<FolderMeta>({ version: 1, icons: {}, colors: {} });
  const [iconPickerPath, setIconPickerPath] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const previewHandleRef = useRef<PreviewHandle | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const syncLockRef = useRef<number>(0);
  const flushSaveRef = useRef<() => Promise<void>>(async () => {});
  const [activeLine, setActiveLine] = useState<number>(1);
  void resolved;

  const cursorAnchorY = useCallback((): number | undefined => {
    const v = editorViewRef.current;
    if (!v) return undefined;
    const head = v.state.selection.main.head;
    const coords = v.coordsAtPos(head);
    if (!coords) return undefined;
    const rect = v.scrollDOM.getBoundingClientRect();
    return Math.max(0, coords.top - rect.top);
  }, []);

  const onEditorCursorLine = useCallback((line: number) => {
    previewHandleRef.current?.setActiveLine(line);
    setActiveLine(line);
    if (Date.now() < syncLockRef.current) return;
    syncLockRef.current = Date.now() + 180;
    previewHandleRef.current?.scrollToLine(line, {
      behavior: "smooth",
      anchorY: cursorAnchorY(),
    });
  }, [cursorAnchorY]);

  const onEditorScrollLine = useCallback((line: number) => {
    if (Date.now() < syncLockRef.current) return;
    syncLockRef.current = Date.now() + 180;
    previewHandleRef.current?.scrollToLine(line, {
      behavior: "auto",
      anchorY: cursorAnchorY(),
    });
  }, [cursorAnchorY]);

  const onPreviewScrollLine = useCallback((line: number) => {
    if (Date.now() < syncLockRef.current) return;
    const v = editorViewRef.current;
    if (!v) return;
    const docLine = Math.max(1, Math.min(v.state.doc.lines, line));
    const lineObj = v.state.doc.line(docLine);
    syncLockRef.current = Date.now() + 180;
    v.dispatch({
      effects: undefined,
      selection: undefined,
    });
    // scroll without moving cursor
    const block = v.lineBlockAt(lineObj.from);
    v.scrollDOM.scrollTo({ top: block.top, behavior: "auto" });
  }, []);

  const onOutlineJump = useCallback((line: number) => {
    const v = editorViewRef.current;
    if (!v) return;
    const docLine = Math.max(1, Math.min(v.state.doc.lines, line));
    const lineObj = v.state.doc.line(docLine);
    syncLockRef.current = Date.now() + 250;
    v.dispatch({
      selection: { anchor: lineObj.from },
      effects: EditorView.scrollIntoView(lineObj.from, { y: "start", yMargin: 24 }),
    });
    v.focus();
    previewHandleRef.current?.setActiveLine(line);
    previewHandleRef.current?.scrollToLine(line, { behavior: "smooth" });
  }, []);

  const onPreviewSelectLine = useCallback((line: number) => {
    const v = editorViewRef.current;
    if (!v) return;
    const docLine = Math.max(1, Math.min(v.state.doc.lines, line));
    const lineObj = v.state.doc.line(docLine);
    syncLockRef.current = Date.now() + 250;
    v.dispatch({
      selection: { anchor: lineObj.from },
      effects: EditorView.scrollIntoView(lineObj.from, { y: "center", yMargin: 24 }),
    });
    v.focus();
    previewHandleRef.current?.setActiveLine(line);
  }, []);

  const basenames = useMemo(
    () =>
      Array.from(
        new Set(
          tree.notes.map((p) => {
            const base = p.split("/").pop() ?? p;
            return base.replace(/\.md$/, "");
          }),
        ),
      ).sort(),
    [tree.notes],
  );

  const [aliasMap, setAliasMap] = useState<Record<string, string[]>>({});

  const basenameCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of tree.notes) {
      const bn = (p.split("/").pop() ?? p).replace(/\.md$/, "").toLowerCase();
      m[bn] = (m[bn] ?? 0) + 1;
    }
    return m;
  }, [tree.notes]);

  const resolveWikilink = useCallback(
    (target: string): string | null => {
      if (!target) return null;
      const trimmed = target.trim();
      const stripped = trimmed.replace(/\.md$/i, "");
      // 1. exact path match (full path)
      if (stripped.includes("/")) {
        const candidate = `${stripped}.md`;
        const lower = candidate.toLowerCase();
        for (const p of tree.notes) {
          if (p === candidate) return p;
          if (p.toLowerCase() === lower) return p;
        }
      }
      // 2. basename match (first wins for ambiguous)
      const lower = stripped.toLowerCase();
      for (const p of tree.notes) {
        const base = (p.split("/").pop() ?? p).replace(/\.md$/, "").toLowerCase();
        if (base === lower) return p;
      }
      // 3. alias from frontmatter
      const aliasHits = aliasMap[lower];
      if (aliasHits && aliasHits.length > 0) return aliasHits[0] ?? null;
      return null;
    },
    [tree.notes, aliasMap],
  );

  const refreshTree = useCallback(async () => {
    try {
      const t = await api.tree();
      setTree(t);
    } catch (e) {
      setToast(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const refreshAliases = useCallback(async () => {
    try {
      const r = await fetch("/api/aliases");
      if (r.ok) {
        setAliasMap((await r.json()) as Record<string, string[]>);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshAliases();
  }, [refreshAliases]);

  useEffect(() => {
    void refreshTree();
  }, [refreshTree]);

  const refreshGit = useCallback(async () => {
    try {
      setGitStatus(await gitApi.status());
    } catch {
      setGitStatus(null);
    }
  }, []);

  const refreshMeta = useCallback(async () => {
    try {
      setFolderMeta(await metaApi.get());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  useEffect(() => {
    void refreshGit();
    const id = window.setInterval(() => void refreshGit(), 8000);
    return () => window.clearInterval(id);
  }, [refreshGit]);

  const doCommit = useCallback(async () => {
    const message = prompt("Commit message", "manual");
    if (message === null) return;
    try {
      await flushSaveRef.current();
      const res = await gitApi.commit(message.trim() || "manual");
      setToast(res.sha ? `Committed ${res.sha.slice(0, 7)}` : "Nothing to commit");
      void refreshGit();
    } catch (e) {
      setToast(`Commit failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refreshGit]);

  const doCheckpoint = useCallback(async () => {
    const message = prompt("Checkpoint name", "milestone");
    if (message === null) return;
    try {
      await flushSaveRef.current();
      const res = await gitApi.checkpoint(message.trim() || "checkpoint");
      setToast(res.sha ? `Checkpoint ${res.tag}` : "Nothing to checkpoint");
      void refreshGit();
    } catch (e) {
      setToast(`Checkpoint failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [refreshGit]);

  useEffect(() => {
    function onHash() {
      const h = window.location.hash;
      if (h.startsWith("#/note/")) {
        const rest = decodeURI(h.slice("#/note/".length));
        // split a single trailing #<slug> off the path
        let p = rest;
        let slug: string | undefined;
        const lastHash = rest.lastIndexOf("#");
        if (lastHash > 0) {
          p = rest.slice(0, lastHash);
          slug = rest.slice(lastHash + 1);
        }
        if (p) openNote(p, { headingSlug: slug });
      } else if (h.startsWith("#/tag/")) {
        setTagFilter(decodeURIComponent(h.slice("#/tag/".length)));
      }
    }
    window.addEventListener("hashchange", onHash);
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNote = useCallback(
    async (p: string, opts?: { headingSlug?: string }) => {
      try {
        const data = await api.readNote(p);
        setPath(p);
        setContent(data.content);
        setTagFilter(null);
        setMobileView("edit");
        const want = `#/note/${encodeURI(p)}${opts?.headingSlug ? `#${opts.headingSlug}` : ""}`;
        if (window.location.hash !== want) window.location.hash = want;
        const bl = await api.backlinks(p);
        setBacklinks(bl);
        if (opts?.headingSlug) {
          // jump to heading after content settles
          setTimeout(() => jumpToHeadingSlug(opts.headingSlug!, data.content), 60);
        }
      } catch (e) {
        setToast(`Open failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [],
  );

  const jumpToHeadingSlug = useCallback((slug: string, body: string) => {
    const lines = body.split(/\r?\n/);
    let inFence = false;
    let seen = new Map<string, number>();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      const trim = line.trim();
      if (trim.startsWith("```") || trim.startsWith("~~~")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (!m) continue;
      const text = (m[2] ?? "").trim();
      const base = text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
      const n = seen.get(base) ?? 0;
      const id = n > 0 ? `${base}-${n}` : base;
      seen.set(base, n + 1);
      if (id === slug) {
        const v = editorViewRef.current;
        if (v) {
          const docLine = i + 1;
          const lineObj = v.state.doc.line(Math.min(docLine, v.state.doc.lines));
          v.dispatch({
            selection: { anchor: lineObj.from },
            effects: EditorView.scrollIntoView(lineObj.from, { y: "start", yMargin: 24 }),
          });
        }
        previewHandleRef.current?.setActiveLine(i + 1);
        previewHandleRef.current?.scrollToLine(i + 1, { behavior: "smooth" });
        return;
      }
    }
  }, []);

  const onSave = useCallback(
    async (p: string, c: string) => {
      await api.writeNote(p, c);
      try {
        const bl = await api.backlinks(p);
        setBacklinks(bl);
      } catch {
        // ignore
      }
      void refreshAliases();
    },
    [refreshAliases],
  );

  const { status: saveStatus, flush } = useDebouncedSave(content, path, onSave, 500);
  flushSaveRef.current = flush;

  const createNote = useCallback(
    async (parentDir: string) => {
      const name = prompt("New note name (no .md)", "Untitled");
      if (!name) return;
      const trimmed = name.trim();
      if (!trimmed) return;
      const rel = (parentDir ? `${parentDir}/` : "") + `${trimmed}.md`;
      try {
        await api.writeNote(rel, `# ${trimmed}\n\n`);
        await refreshTree();
        await openNote(rel);
      } catch (e) {
        setToast(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [openNote, refreshTree],
  );

  const createFolder = useCallback(
    async (parentDir: string) => {
      const name = prompt("New folder name");
      if (!name) return;
      const rel = (parentDir ? `${parentDir}/` : "") + name.trim();
      try {
        await api.mkdir(rel);
        await refreshTree();
      } catch (e) {
        setToast(`Create folder failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [refreshTree],
  );

  const renameItem = useCallback(
    async (p: string, isFolder: boolean) => {
      const cur = p.split("/").pop() ?? p;
      const curBase = isFolder ? cur : cur.replace(/\.md$/, "");
      const next = prompt(`Rename ${isFolder ? "folder" : "note"}`, curBase);
      if (!next || next === curBase) return;
      const dir = p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
      const target = isFolder ? `${dir}${next}` : `${dir}${next}.md`;
      try {
        if (isFolder) {
          setToast("Folder rename not yet supported");
          return;
        }
        const res = await api.rename(p, target);
        setToast(`Renamed (${res.totalReplacements} link${res.totalReplacements === 1 ? "" : "s"} patched)`);
        await refreshTree();
        if (path === p) await openNote(target);
      } catch (e) {
        setToast(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [openNote, path, refreshTree],
  );

  const deleteItem = useCallback(
    async (p: string, isFolder: boolean) => {
      if (!confirm(`Move ${isFolder ? "folder" : "note"} "${p}" to trash?`)) return;
      try {
        if (isFolder) await api.deleteFolder(p);
        else await api.deleteNote(p);
        if (path === p) {
          setPath(null);
          setContent("");
        }
        await refreshTree();
      } catch (e) {
        setToast(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [path, refreshTree],
  );

  const uploadMediaForCurrent = useCallback(
    async (file: File): Promise<string> => {
      if (!path) throw new Error("no active note");
      const res = await api.uploadMedia(path, file);
      return res.name;
    },
    [path],
  );

  const openDaily = useCallback(async () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, "0");
    const d = String(today.getDate()).padStart(2, "0");
    const name = `${y}-${m}-${d}`;
    const rel = `${dailyDir ? `${dailyDir}/` : ""}${name}.md`;
    try {
      await api.readNote(rel);
    } catch {
      await api.writeNote(rel, `# ${name}\n\n`);
      await refreshTree();
    }
    await openNote(rel);
  }, [dailyDir, openNote, refreshTree]);

  const refreshSettings = useCallback(async () => {
    try {
      const s = await settingsApi.get();
      setSettings(s);
    } catch {
      // ignore — fall back to defaults
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const updateSettings = useCallback(
    async (patch: Parameters<typeof settingsApi.patch>[0]) => {
      try {
        const s = await settingsApi.patch(patch);
        setSettings(s);
      } catch (e) {
        setToast(`Settings save failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [],
  );

  const toggleBookmark = useCallback(() => {
    if (!path) return;
    const next = bookmarks.includes(path) ? bookmarks.filter((b) => b !== path) : [...bookmarks, path];
    void updateSettings({ bookmarks: next });
  }, [bookmarks, path, updateSettings]);

  const setDailyDir = useCallback(
    (dir: string) => {
      void updateSettings({ dailyDir: dir });
    },
    [updateSettings],
  );

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setCmd("switcher");
      } else if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setCmd("search");
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setCmd("search");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const onFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !path) return;
      for (const f of Array.from(files)) {
        try {
          await uploadMediaForCurrent(f);
          setContent((c) => `${c}${c.endsWith("\n") ? "" : "\n"}![[${f.name}]]\n`);
        } catch (err) {
          setToast(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      e.target.value = "";
    },
    [path, uploadMediaForCurrent],
  );

  const [tagFilteredNotes, setTagFilteredNotes] = useState<string[] | null>(null);

  useEffect(() => {
    if (!tagFilter) {
      setTagFilteredNotes(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch(`/api/tags/notes?tag=${encodeURIComponent(tagFilter)}`);
        if (!r.ok) throw new Error(`${r.status}`);
        const notes = (await r.json()) as string[];
        if (!cancelled) setTagFilteredNotes(notes);
      } catch {
        if (!cancelled) setTagFilteredNotes([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tagFilter]);

  return (
    <TooltipProvider>
    <div className="shell">
      <header className="topbar">
        <button
          className="btn icon menu-btn"
          aria-label="Toggle navigation"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <MenuIcon />
        </button>
        <span className="title">{path ? path.replace(/\.md$/, "") : "brain.md"}</span>
        <span className="saved">
          {path
            ? saveStatus === "saved"
              ? "saved"
              : saveStatus === "dirty"
                ? "unsaved"
                : saveStatus === "saving"
                  ? "saving…"
                  : "error"
            : ""}
        </span>
        <button className="btn icon" title="Search (⌘P)" onClick={() => setCmd("search")}>
          <SearchIcon />
        </button>
        <button className="btn icon" title="Quick switch (⌘O)" onClick={() => setCmd("switcher")}>
          <SearchIcon />
        </button>
        <button
          className="btn icon"
          title={path && bookmarks.includes(path) ? "Remove bookmark" : "Bookmark"}
          onClick={toggleBookmark}
          disabled={!path}
        >
          <StarIcon filled={path ? bookmarks.includes(path) : false} />
        </button>
        <button className="btn icon" title="Daily note" onClick={openDaily}>
          <CalendarIcon />
        </button>
        <button className="btn icon" title="Tasks" onClick={() => setShowTasks(true)}>
          <CheckSquareIcon />
        </button>
        <button className="btn icon" title="Trash" onClick={() => setShowTrash(true)}>
          <TrashIcon />
        </button>
        {gitStatus?.enabled ? (
          <>
            <GitStatusChip status={gitStatus} />
            <button className="btn icon" title="History" onClick={() => setShowHistory(true)}>
              <HistoryIcon />
            </button>
            <button className="btn icon" title="Commit now" onClick={doCommit}>
              <GitCommitIcon />
            </button>
            <button className="btn icon" title="Checkpoint" onClick={doCheckpoint}>
              <FlagIcon />
            </button>
          </>
        ) : null}
        <ThemeButton theme={theme} setTheme={setTheme} />
        <button className="btn icon" title="Settings" onClick={() => setShowSettings(true)}>
          <SettingsIcon />
        </button>
      </header>

      <aside className={clsx("sidebar", drawerOpen && "open")}>
        <header>
          <strong style={{ fontSize: "var(--text-sm)", color: "var(--text-2)" }}>Vault</strong>
          <span style={{ flex: 1 }} />
          <button className="btn icon" title="Search (⌘P)" onClick={() => setCmd("search")}>
            <SearchIcon />
          </button>
          <button className="btn icon" title="New note" onClick={() => createNote("")}>
            <FilePlusIcon />
          </button>
          <button className="btn icon" title="New folder" onClick={() => createFolder("")}>
            <FolderPlusIcon />
          </button>
        </header>
        {bookmarks.length > 0 ? (
          <div style={{ padding: "8px 8px 0" }}>
            <h3 style={{ fontSize: "var(--text-xs)", color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4px 4px" }}>
              Bookmarks
            </h3>
            {bookmarks.map((b) => (
              <div key={b} className={clsx("tree-row", b === path && "active")} onClick={() => openNote(b)}>
                <span className="chev" />
                <StarIcon filled />
                <span className="label">{(b.split("/").pop() ?? b).replace(/\.md$/, "")}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="tree-wrap scroll">
          <FileTree
            data={tree}
            activePath={path}
            folderIcons={folderMeta.icons}
            basenameCounts={basenameCounts}
            onOpen={(p) => {
              void openNote(p);
              setDrawerOpen(false);
            }}
            onCreateNote={createNote}
            onCreateFolder={createFolder}
            onRename={renameItem}
            onDelete={deleteItem}
            onSetIcon={(p) => setIconPickerPath(p)}
          />
        </div>
        {path ? (
          <div className="side-section">
            <div className="side-head">Outline</div>
            <div className="side-body scroll">
              <Outline content={content} onJump={onOutlineJump} />
            </div>
          </div>
        ) : null}
        {path ? (
          <div className="side-section">
            <div className="side-head">Backlinks{backlinks.length > 0 ? ` · ${backlinks.length}` : ""}</div>
            <div className="side-body scroll">
              <Backlinks items={backlinks} onOpen={openNote} />
            </div>
          </div>
        ) : null}
      </aside>

      {drawerOpen && isMobile ? <div className="drawer-backdrop open" onClick={() => setDrawerOpen(false)} /> : null}

      <main ref={mainRef} className={clsx("main", isMobile && mobileView === "preview" && "show-preview", path && "has-toolbar")}>
        <div className="pane-head editor-head">
          <PenIcon />
          <span>Editor</span>
        </div>
        <div className="pane-head preview-head">
          <EyeIcon />
          <span>Preview</span>
        </div>
        {path ? (
          <div className="toolbar-row">
            <EditorToolbar
              getView={() => editorViewRef.current}
              onUploadClick={() => uploadInputRef.current?.click()}
            />
          </div>
        ) : null}
        <section className="pane editor-pane">
          {path ? (
            <>
              <Editor
                value={content}
                onChange={setContent}
                onBlur={() => void flush()}
                basenames={basenames}
                onUploadMedia={uploadMediaForCurrent}
                viewRefOut={editorViewRef}
                onCursorLine={onEditorCursorLine}
                onScrollLine={onEditorScrollLine}
              />
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/*,video/*,audio/*,application/pdf"
                multiple
                hidden
                onChange={onFileInputChange}
              />
            </>
          ) : tagFilter ? (
            <TagFilterView tag={tagFilter} notes={tagFilteredNotes ?? []} onOpen={openNote} onClear={() => setTagFilter(null)} />
          ) : (
            <div className="empty-state">
              <h2>No note open</h2>
              <p className="hint">Pick a note from the sidebar or press ⌘O to switch.</p>
              <button className="btn primary" onClick={() => createNote("")}>
                <PlusIcon /> New note
              </button>
            </div>
          )}
        </section>
        <section className="pane preview-pane">
          <Preview
            ref={previewHandleRef}
            content={content}
            notePath={path}
            resolveByBasename={resolveWikilink}
            onOpenNote={openNote}
            onOpenTag={(tag) => {
              setTagFilter(tag);
              setPath(null);
              setContent("");
              window.location.hash = `#/tag/${encodeURIComponent(tag)}`;
            }}
            onScrollLine={onPreviewScrollLine}
            onSelectLine={onPreviewSelectLine}
          />
        </section>
        {path && !isMobile ? (
          <SyncConnector
            mainRef={mainRef}
            editorViewRef={editorViewRef}
            trigger={activeLine}
            hidden={isMobile}
          />
        ) : null}
      </main>

      {isMobile ? (
        <nav className="mobile-tabs" aria-label="Editor view">
          <Tabs
            value={mobileView}
            onValueChange={(v) => setMobileView(v as "edit" | "preview")}
            className="w-full"
          >
            <TabsList className="w-full">
              <TabsTrigger value="edit" className="flex-1 gap-1.5">
                <PenIcon /> Edit
              </TabsTrigger>
              <TabsTrigger value="preview" className="flex-1 gap-1.5">
                <EyeIcon /> Preview
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </nav>
      ) : null}

      <CommandBar mode={cmd} onClose={() => setCmd(null)} onOpenNote={openNote} tree={tree} />

      {showSettings ? (
        <Settings
          onClose={() => setShowSettings(false)}
          theme={theme}
          setTheme={setTheme}
          dailyDir={dailyDir}
          setDailyDir={setDailyDir}
        />
      ) : null}

      {showTasks ? (
        <TasksView
          onClose={() => setShowTasks(false)}
          onOpen={(p) => {
            void openNote(p);
            setShowTasks(false);
          }}
        />
      ) : null}

      {showTrash ? (
        <TrashView
          onClose={() => setShowTrash(false)}
          onRestored={() => void refreshTree()}
        />
      ) : null}

      {showHistory ? (
        <HistoryPanel
          path={path}
          onClose={() => setShowHistory(false)}
          onRestored={async () => {
            if (path) {
              const data = await api.readNote(path);
              setContent(data.content);
            }
            void refreshTree();
            void refreshGit();
          }}
        />
      ) : null}

      {iconPickerPath !== null ? (
        <IconPicker
          folderPath={iconPickerPath}
          currentIcon={folderMeta.icons[iconPickerPath] ?? null}
          onClose={() => setIconPickerPath(null)}
          onSave={async (icon) => {
            try {
              const res = await metaApi.set(iconPickerPath, icon);
              setFolderMeta(res.meta);
            } catch (e) {
              setToast(`Icon save failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            setIconPickerPath(null);
          }}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
    <Toaster />
    </TooltipProvider>
  );
}

function GitStatusChip({ status }: { status: GitStatus }) {
  if (!status.enabled) return null;
  const cls = status.dirty ? "dirty" : "clean";
  const ts = status.lastCommit
    ? new Date(status.lastCommit.ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  return (
    <span
      className={`history-status-bar ${cls}`}
      title={
        status.lastCommit
          ? `${status.lastCommit.subject}\n${status.lastCommit.sha.slice(0, 7)} · ${new Date(status.lastCommit.ts).toLocaleString()}`
          : "no commits yet"
      }
    >
      <span className="dot" />
      <span>{status.dirty ? "uncommitted" : ts}</span>
    </span>
  );
}

function ThemeButton({ theme, setTheme }: { theme: ReturnType<typeof useTheme>["theme"]; setTheme: (t: ReturnType<typeof useTheme>["theme"]) => void }) {
  return (
    <button
      className="btn icon"
      title={`Theme: ${theme}`}
      onClick={() => {
        const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
        setTheme(next);
      }}
    >
      {theme === "dark" ? <MoonIcon /> : theme === "light" ? <SunIcon /> : <SunIcon />}
    </button>
  );
}

function TagFilterView({
  tag,
  notes,
  onOpen,
  onClear,
}: {
  tag: string;
  notes: string[];
  onOpen: (p: string) => void;
  onClear: () => void;
}) {
  return (
    <div style={{ padding: "var(--space-5)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <TagIcon />
        <strong>#{tag}</strong>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClear}>Clear</button>
      </div>
      {notes.length === 0 ? (
        <p className="muted">No notes with this tag.</p>
      ) : (
        <ul style={{ paddingLeft: 16 }}>
          {notes.map((n) => (
            <li key={n} style={{ margin: "6px 0" }}>
              <a href="#" onClick={(e) => { e.preventDefault(); onOpen(n); }}>
                {n.replace(/\.md$/, "")}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
