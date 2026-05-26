import type { EditorView } from "@codemirror/view";
import { EditorSelection, type ChangeSpec } from "@codemirror/state";

function eachRange(view: EditorView, fn: (from: number, to: number) => { changes?: ChangeSpec; range?: { anchor: number; head?: number } } | null) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const r = fn(range.from, range.to);
      if (!r)
        return { range };
      return {
        changes: r.changes,
        range: r.range
          ? EditorSelection.range(r.range.anchor, r.range.head ?? r.range.anchor)
          : range,
      };
    }),
  );
  view.focus();
}

export function toggleInlineWrap(view: EditorView, marker: string) {
  const state = view.state;
  eachRange(view, (from, to) => {
    if (from === to) {
      return {
        changes: { from, insert: `${marker}${marker}` },
        range: { anchor: from + marker.length },
      };
    }
    const doc = state.doc.sliceString(from, to);
    const wrapLen = marker.length;
    const before = state.doc.sliceString(Math.max(0, from - wrapLen), from);
    const after = state.doc.sliceString(to, Math.min(state.doc.length, to + wrapLen));
    if (before === marker && after === marker) {
      return {
        changes: [
          { from: from - wrapLen, to: from, insert: "" },
          { from: to, to: to + wrapLen, insert: "" },
        ],
        range: { anchor: from - wrapLen, head: to - wrapLen },
      };
    }
    return {
      changes: { from, to, insert: `${marker}${doc}${marker}` },
      range: { anchor: from + wrapLen, head: to + wrapLen },
    };
  });
}

export function toggleLinePrefix(view: EditorView, prefixIfAbsent: string, matcher: RegExp, removeOnMatch = true) {
  const state = view.state;
  const changes: ChangeSpec[] = [];
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let n = startLine; n <= endLine; n++) {
      const line = state.doc.line(n);
      const m = line.text.match(matcher);
      if (m && removeOnMatch) {
        changes.push({ from: line.from, to: line.from + m[0].length, insert: "" });
      } else {
        changes.push({ from: line.from, insert: prefixIfAbsent });
      }
    }
  }
  view.dispatch({ changes });
  view.focus();
}

export function setHeading(view: EditorView, level: 1 | 2 | 3 | 4 | 5 | 6) {
  const target = `${"#".repeat(level)} `;
  toggleLinePrefix(view, target, /^#{1,6}\s+/);
}

export function bullet(view: EditorView) {
  toggleLinePrefix(view, "- ", /^(\s*)[-*+]\s+/);
}

export function numbered(view: EditorView) {
  toggleLinePrefix(view, "1. ", /^(\s*)\d+\.\s+/);
}

export function task(view: EditorView) {
  toggleLinePrefix(view, "- [ ] ", /^(\s*)[-*+]\s+\[[ xX]\]\s+/);
}

export function quote(view: EditorView) {
  toggleLinePrefix(view, "> ", /^>\s?/);
}

export function bold(view: EditorView) {
  toggleInlineWrap(view, "**");
}

export function italic(view: EditorView) {
  toggleInlineWrap(view, "*");
}

export function strike(view: EditorView) {
  toggleInlineWrap(view, "~~");
}

export function highlight(view: EditorView) {
  toggleInlineWrap(view, "==");
}

export function inlineCode(view: EditorView) {
  toggleInlineWrap(view, "`");
}

export function codeBlock(view: EditorView, lang = "") {
  const state = view.state;
  eachRange(view, (from, to) => {
    const sel = state.doc.sliceString(from, to);
    const text = `\n\`\`\`${lang}\n${sel || ""}\n\`\`\`\n`;
    return {
      changes: { from, to, insert: text },
      range: { anchor: from + 4 + lang.length + 1, head: from + 4 + lang.length + 1 + sel.length },
    };
  });
}

export function mathInline(view: EditorView) {
  toggleInlineWrap(view, "$");
}

export function mathBlock(view: EditorView) {
  const state = view.state;
  eachRange(view, (from, to) => {
    const sel = state.doc.sliceString(from, to);
    const text = `\n$$\n${sel || "f(x)"}\n$$\n`;
    return {
      changes: { from, to, insert: text },
      range: { anchor: from + 4, head: from + 4 + (sel.length || 4) },
    };
  });
}

export function link(view: EditorView) {
  const state = view.state;
  eachRange(view, (from, to) => {
    const sel = state.doc.sliceString(from, to);
    if (sel === "") {
      const text = `[](url)`;
      return { changes: { from, insert: text }, range: { anchor: from + 1, head: from + 1 } };
    }
    return { changes: { from, to, insert: `[${sel}](url)` }, range: { anchor: from + sel.length + 3, head: from + sel.length + 6 } };
  });
}

export function wikilink(view: EditorView) {
  const state = view.state;
  eachRange(view, (from, to) => {
    const sel = state.doc.sliceString(from, to);
    if (sel === "") {
      return { changes: { from, insert: `[[]]` }, range: { anchor: from + 2 } };
    }
    return { changes: { from, to, insert: `[[${sel}]]` }, range: { anchor: from + 2, head: from + 2 + sel.length } };
  });
}

export function image(view: EditorView) {
  const state = view.state;
  eachRange(view, (from, to) => {
    const sel = state.doc.sliceString(from, to);
    return { changes: { from, to, insert: `![[${sel || "image.png"}]]` }, range: { anchor: from + 3, head: from + 3 + (sel.length || 9) } };
  });
}

export function table(view: EditorView) {
  const state = view.state;
  eachRange(view, (from) => {
    const text = `\n| col 1 | col 2 | col 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n`;
    return { changes: { from, insert: text }, range: { anchor: from + text.length } };
  });
}

export function callout(view: EditorView, kind: "note" | "info" | "tip" | "warning" | "danger" | "quote" = "note") {
  const state = view.state;
  eachRange(view, (from, to) => {
    const sel = state.doc.sliceString(from, to);
    const text = `\n> [!${kind}]\n> ${sel || "callout body"}\n`;
    return { changes: { from, to, insert: text }, range: { anchor: from + 1 + 4 + kind.length + 4, head: from + 1 + 4 + kind.length + 4 + (sel.length || 12) } };
  });
}

export function horizontalRule(view: EditorView) {
  const state = view.state;
  eachRange(view, (from) => ({
    changes: { from, insert: `\n---\n` },
    range: { anchor: from + 5 },
  }));
}

export function indent(view: EditorView) {
  toggleLinePrefix(view, "  ", /^(\s{0,2})/, false);
}
