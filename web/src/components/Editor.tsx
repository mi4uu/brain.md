import { useEffect, useMemo, useRef, useState } from "react";
import { EditorView, keymap, drawSelection, dropCursor, highlightActiveLine } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle, bracketMatching, indentOnInput } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import {
  autocompletion,
  completionKeymap,
  startCompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { isMediaName } from "../renderer/render";

function wikilinkFor(name: string): string {
  return isMediaName(name) ? `![[${name}]]` : `[[${name}]]`;
}

// V61: brain.md syntax highlight. Reads our `--cm-*` CSS vars so the
// editor follows the active theme (dark/light). The vars themselves
// resolve to #ffcc00 for links/url/atoms in dark mode, see tokens.css.
const brainHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--cm-heading)", fontWeight: "bold", textDecoration: "underline" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.keyword, color: "var(--cm-keyword)" },
  { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName, tags.link],
    color: "var(--cm-url)" },
  { tag: [tags.literal, tags.inserted], color: "var(--cm-literal)" },
  { tag: [tags.string, tags.deleted], color: "var(--cm-string)" },
  { tag: [tags.regexp, tags.escape], color: "var(--cm-regexp)" },
  { tag: tags.variableName, color: "var(--cm-var)" },
  { tag: [tags.typeName, tags.namespace], color: "var(--cm-type)" },
  { tag: tags.className, color: "var(--cm-class)" },
  { tag: tags.macroName, color: "var(--cm-macro)" },
  { tag: tags.propertyName, color: "var(--cm-prop)" },
  { tag: tags.comment, color: "var(--cm-comment)", fontStyle: "italic" },
  { tag: tags.meta, color: "var(--cm-meta)" },
  { tag: tags.invalid, color: "var(--cm-invalid)" },
]);

interface EditorProps {
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  basenames: string[];
  onUploadMedia: (file: File) => Promise<string>; // returns wikilink basename
  disabled?: boolean;
  viewRefOut?: { current: EditorView | null };
  onCursorLine?: (line: number) => void;
  onScrollLine?: (line: number) => void;
}

export function Editor({
  value,
  onChange,
  onBlur,
  basenames,
  onUploadMedia,
  disabled,
  viewRefOut,
  onCursorLine,
  onScrollLine,
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const basenamesRef = useRef(basenames);
  const onUploadRef = useRef(onUploadMedia);
  const onBlurRef = useRef(onBlur);
  const onCursorLineRef = useRef(onCursorLine);
  const onScrollLineRef = useRef(onScrollLine);
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    basenamesRef.current = basenames;
  }, [basenames]);
  useEffect(() => {
    onUploadRef.current = onUploadMedia;
  }, [onUploadMedia]);
  useEffect(() => {
    onBlurRef.current = onBlur;
  }, [onBlur]);
  useEffect(() => {
    onCursorLineRef.current = onCursorLine;
  }, [onCursorLine]);
  useEffect(() => {
    onScrollLineRef.current = onScrollLine;
  }, [onScrollLine]);

  useEffect(() => {
    if (!hostRef.current) return;
    const wikilinkCompletion = (ctx: CompletionContext): CompletionResult | null => {
      const before = ctx.matchBefore(/\[\[[^\[\]\n]*$/);
      if (!before) return null;
      const query = before.text.slice(2);
      const opts = basenamesRef.current
        .filter((n) => n.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 30)
        .map((n) => ({
          label: n,
          apply: `${n}]]`,
          type: "variable",
        }));
      return { from: before.from + 2, options: opts, validFor: /^[^\[\]\n]*$/ };
    };

    const atMentionCompletion = (ctx: CompletionContext): CompletionResult | null => {
      const before = ctx.matchBefore(/(^|[\s.,;:!?(){}\[\]])@[A-Za-z0-9_\-]*$/);
      if (!before) return null;
      const atIdx = before.text.lastIndexOf("@");
      if (atIdx < 0) return null;
      const query = before.text.slice(atIdx + 1);
      if (!ctx.explicit && query === "") return null;
      const opts = basenamesRef.current
        .filter((n) => n.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 30)
        .map((n) => ({
          label: n,
          detail: "note",
          apply: `[[${n}]]`,
          type: "variable",
        }));
      return {
        from: before.from + atIdx,
        options: opts,
        validFor: /^@[A-Za-z0-9_\-]*$/,
      };
    };

    let lastCursorLine = -1;
    const updateExt = EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        onChangeRef.current(u.state.doc.toString());
        if (u.transactions.some((tr) => tr.isUserEvent("input.type") || tr.isUserEvent("input.paste"))) {
          const head = u.state.selection.main.head;
          const lineObj = u.state.doc.lineAt(head);
          const col = head - lineObj.from;
          const before = lineObj.text.slice(0, col);
          const prev1 = before.slice(-1);
          const prev2 = before.slice(-2);
          if (prev1 === "@" || prev2 === "[[") {
            queueMicrotask(() => startCompletion(u.view));
          }
        }
      }
      if (u.selectionSet || u.docChanged) {
        const head = u.state.selection.main.head;
        const line = u.state.doc.lineAt(head).number;
        if (line !== lastCursorLine) {
          lastCursorLine = line;
          onCursorLineRef.current?.(line);
        }
      }
    });

    const scrollExt = EditorView.domEventHandlers({
      scroll(_e, v) {
        const cb = onScrollLineRef.current;
        if (!cb) return;
        const top = v.scrollDOM.scrollTop;
        const blockInfo = v.lineBlockAtHeight(top - v.documentTop + 1);
        const line = v.state.doc.lineAt(blockInfo.from).number;
        cb(line);
      },
    });

    const blurExt = EditorView.domEventHandlers({
      blur() {
        onBlurRef.current?.();
      },
      dragenter(e) {
        const t = e.dataTransfer?.types;
        if (!t) return;
        if (t.includes("Files") || t.includes("application/x-brain-note")) {
          e.preventDefault();
          setDropActive(true);
        }
      },
      dragover(e) {
        const t = e.dataTransfer?.types;
        if (!t) return;
        if (t.includes("Files") || t.includes("application/x-brain-note")) {
          e.preventDefault();
          setDropActive(true);
        }
      },
      dragleave(e) {
        if (e.target === hostRef.current) setDropActive(false);
      },
      drop(e, view) {
        const dt = e.dataTransfer;
        if (!dt) return false;
        const noteRaw = dt.getData("application/x-brain-note");
        if (noteRaw) {
          e.preventDefault();
          setDropActive(false);
          try {
            const payload = JSON.parse(noteRaw) as { path?: string; basename?: string; linkTarget?: string };
            const target =
              payload.linkTarget ||
              (payload.basename ?? payload.path ?? "").replace(/\.md$/, "").split("/").pop() ||
              "";
            if (!target) return true;
            const insertText = `[[${target}]]`;
            const dropPos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            const pos = dropPos ?? view.state.selection.main.head;
            view.dispatch({
              changes: { from: pos, insert: insertText },
              selection: { anchor: pos + insertText.length },
            });
            view.focus();
          } catch {
            // ignore bad payload
          }
          return true;
        }

        if (!dt.files?.length) return false;
        e.preventDefault();
        setDropActive(false);
        const files = Array.from(dt.files);
        void (async () => {
          const inserts: string[] = [];
          for (const f of files) {
            try {
              const name = await onUploadRef.current(f);
              inserts.push(wikilinkFor(name));
            } catch {
              inserts.push(`<!-- upload failed: ${f.name} -->`);
            }
          }
          const pos = view.state.selection.main.head;
          const text = inserts.join("\n");
          view.dispatch({
            changes: { from: pos, insert: text },
            selection: { anchor: pos + text.length },
          });
        })();
        return true;
      },
      paste(e, view) {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
          if (item.kind === "file") {
            const file = item.getAsFile();
            if (!file) continue;
            e.preventDefault();
            void onUploadRef.current(file).then((name) => {
              const pos = view.state.selection.main.head;
              const insert = wikilinkFor(name);
              view.dispatch({
                changes: { from: pos, insert },
                selection: { anchor: pos + insert.length },
              });
            });
            return;
          }
        }
      },
    });

    const baseExtensions: Extension[] = [
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      markdown({ base: markdownLanguage }),
      // V61: theme-aware highlight that uses our token CSS vars instead
      // of `defaultHighlightStyle`'s hardcoded light-theme colors. The
      // upstream defaults paint URLs `#219` (dark navy) which is unread-
      // able on the dark `--bg-surface` (#1c1c20). Each tag now points
      // at a CSS var so the same Editor instance reskins itself when
      // [data-theme] flips, no rebuild.
      syntaxHighlighting(brainHighlightStyle, { fallback: true }),
      autocompletion({
        override: [wikilinkCompletion, atMentionCompletion],
        closeOnBlur: false,
        activateOnTyping: true,
      }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...completionKeymap,
        indentWithTab,
      ]),
      EditorView.lineWrapping,
      updateExt,
      scrollExt,
      blurExt,
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions: baseExtensions }),
      parent: hostRef.current,
    });
    viewRef.current = view;
    if (viewRefOut) viewRefOut.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      if (viewRefOut) viewRefOut.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.contentDOM.setAttribute("aria-disabled", disabled ? "true" : "false");
    v.contentDOM.contentEditable = disabled ? "false" : "true";
  }, [disabled]);

  return (
    <div ref={hostRef} className="editor-host">
      {dropActive ? <div className="drop-overlay">drop to upload</div> : null}
    </div>
  );
}
