import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { renderMarkdown } from "../renderer/render";
import { resolveWikilinkIn } from "./resolve";
import "../styles/tokens.css";
import "../styles/preview.css";
import "../styles/hljs.css";
import "./note.css";

interface Note {
  path: string;
  content: string;
  mtime?: number;
}

interface Backlink {
  from: string;
  lineNo?: number;
  context?: string;
}

const root = document.getElementById("root") as HTMLElement;
const app = new App({ name: "brain.md note", version: "1" }, {}, { autoResize: true });

let notes: string[] = [];
const history: string[] = [];
let seq = 0;

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  const first = result.content?.find((c) => c.type === "text");
  return first?.text ?? "";
}

async function callJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await app.callServerTool({ name, arguments: args });
  const text = textOf(res);
  if (res.isError) throw new Error(errorMessage(text));
  return JSON.parse(text) as T;
}

function errorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text;
  } catch {
    return text || "unknown error";
  }
}

async function loadNoteList(): Promise<string[]> {
  try {
    const tree = await callJson<{ notes: string[] }>("list_notes", {});
    notes = tree.notes;
  } catch {
    // keep the last list: a failed refresh should not break every link
  }
  return notes;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function showStatus(message: string, isError = false): void {
  root.replaceChildren(el("p", { className: isError ? "status error" : "status" }, [message]));
}

function titleOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

async function render(note: Note, token: number): Promise<void> {
  const list = await loadNoteList();
  if (token !== seq) return;
  const { html } = renderMarkdown(note.content, {
    resolveWikilink: (target) => resolveWikilinkIn(list, target),
    isMediaTarget: () => false,
    buildMediaUrl: () => "",
  });

  const header = el("header", { className: "bar" }, [
    el("button", {
      className: "back",
      type: "button",
      disabled: history.length === 0,
      textContent: "Back",
      onclick: () => {
        const prev = history.pop();
        if (prev) void open(prev, false);
      },
    }),
    el("span", { className: "path", title: note.path, textContent: note.path }),
  ]);

  const doc = el("article", { className: "doc" });
  doc.innerHTML = html;
  for (const img of doc.querySelectorAll("img, video, audio")) {
    img.replaceWith(el("span", { className: "media-placeholder", textContent: "media not shown here" }));
  }

  const backlinks = el("section", { className: "backlinks" }, [el("h2", { textContent: "Backlinks" })]);
  const view = el("div", { className: "preview" }, [header, doc, backlinks]);
  root.replaceChildren(view);
  void fillBacklinks(note.path, backlinks);
}

async function fillBacklinks(path: string, section: HTMLElement): Promise<void> {
  try {
    const items = await callJson<Backlink[]>("get_backlinks", { path });
    if (items.length === 0) {
      section.append(el("p", { className: "muted", textContent: "No backlinks." }));
      return;
    }
    const ul = el("ul");
    const seen = new Set<string>();
    for (const b of items) {
      if (seen.has(b.from)) continue;
      seen.add(b.from);
      ul.append(
        el("li", {}, [
          el("a", {
            href: "#",
            className: "wikilink",
            textContent: titleOf(b.from),
            title: b.from,
            onclick: (e: MouseEvent) => {
              e.preventDefault();
              void open(b.from, true);
            },
          }),
          ...(b.context ? [el("span", { className: "context", textContent: b.context })] : []),
        ]),
      );
    }
    section.append(ul);
  } catch (err) {
    section.append(el("p", { className: "muted", textContent: `Backlinks unavailable: ${(err as Error).message}` }));
  }
}

let current: string | null = null;

async function open(path: string, pushHistory: boolean): Promise<void> {
  const token = ++seq;
  if (pushHistory && current) history.push(current);
  showStatus("Loading…");
  try {
    const note = await callJson<Note>("read_note", { path });
    if (token !== seq) return;
    current = note.path;
    await render(note, token);
  } catch (err) {
    if (token === seq) showStatus(`Could not open ${path}: ${(err as Error).message}`, true);
  }
}

root.addEventListener("click", (e) => {
  const a = (e.target as Element | null)?.closest("a");
  if (!a) return;
  const resolved = a.classList.contains("wikilink") ? a.getAttribute("data-resolved") : null;
  if (resolved && notes.includes(resolved)) {
    e.preventDefault();
    void open(resolved, true);
    return;
  }
  const href = a.getAttribute("href") ?? "";
  if (/^https?:\/\//i.test(href)) {
    e.preventDefault();
    void app.openLink({ url: href }).catch(() => {});
    return;
  }
  if (!href.startsWith("#") || href === "#") e.preventDefault();
});

function applyContext(ctx: McpUiHostContext | undefined): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.onhostcontextchanged = (ctx) => applyContext({ ...app.getHostContext(), ...ctx });

app.ontoolresult = (result) => {
  const text = textOf(result);
  if (result.isError) {
    showStatus(errorMessage(text), true);
    return;
  }
  try {
    const note = JSON.parse(text) as Note;
    current = note.path;
    void render(note, ++seq);
  } catch {
    showStatus("Unexpected read_note result.", true);
  }
};

showStatus("Waiting for the note…");
await app.connect();
applyContext(app.getHostContext());
