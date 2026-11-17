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
    const parsed = JSON.parse(text) as { error?: string; code?: string };
    if (!parsed.error) return text;
    return parsed.code ? `${parsed.error} (${parsed.code})` : parsed.error;
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

function renderDoc(note: Note): HTMLElement {
  const list = notes;
  const { html } = renderMarkdown(note.content, {
    resolveWikilink: (target) => resolveWikilinkIn(list, target),
    isMediaTarget: () => false,
    buildMediaUrl: () => "",
  });
  const doc = el("article", { className: "doc" });
  doc.innerHTML = html;
  for (const media of doc.querySelectorAll("img, video, audio")) {
    media.replaceWith(el("span", { className: "media-placeholder", textContent: "media not shown here" }));
  }
  return doc;
}

// Paint from the tool result first: list_notes goes through the host's
// tool policy and may be slow, prompted or denied. Links are re-resolved
// when the list arrives.
async function render(note: Note, token: number): Promise<void> {

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

  const doc = renderDoc(note);
  const backlinks = el("section", { className: "backlinks" }, [el("h2", { textContent: "Backlinks" })]);
  const view = el("div", { className: "preview" }, [header, doc, backlinks]);
  root.replaceChildren(view);
  void fillBacklinks(note.path, backlinks);

  const before = notes;
  await loadNoteList();
  if (token !== seq || notes === before) return;
  doc.replaceWith(renderDoc(note));
}

async function openTarget(target: string): Promise<void> {
  const name = target.split("#")[0] ?? target;
  const list = await loadNoteList();
  const hit = resolveWikilinkIn(list, name);
  await open(hit ?? `${name.replace(/\.md$/i, "")}.md`, true);
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
  if (a.classList.contains("wikilink")) {
    e.preventDefault();
    const resolved = a.getAttribute("data-resolved");
    const target = a.getAttribute("data-wikilink");
    if (resolved && notes.includes(resolved)) void open(resolved, true);
    else if (target) void openTarget(target);
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

// Some hosts mount the view but never forward the tool result, e.g. when
// the model runs the tool from a code sandbox instead of a direct call.
// After FALLBACK_MS the view loads the note itself, or offers a picker.
const FALLBACK_MS = 6000;
let gotResult = false;
let connected = false;
let inputPath: string | null = null;

async function showPicker(): Promise<void> {
  const token = ++seq;
  showStatus("Loading notes…");
  let list: string[];
  try {
    list = (await callJson<{ notes: string[] }>("list_notes", {})).notes;
  } catch (err) {
    if (token === seq) showStatus(`No note to show, and the note list failed: ${(err as Error).message}`, true);
    return;
  }
  if (token !== seq) return;
  notes = list;
  const results = el("ul", { className: "picker-list" });
  const fill = (q: string) => {
    const needle = q.trim().toLowerCase();
    const hits = list.filter((p) => p.toLowerCase().includes(needle)).slice(0, 100);
    results.replaceChildren(
      ...hits.map((p) =>
        el("li", {}, [
          el("a", {
            href: "#",
            className: "picker-item",
            textContent: titleOf(p),
            title: p,
            onclick: (e: MouseEvent) => {
              e.preventDefault();
              void open(p, false);
            },
          }),
          el("span", { className: "context", textContent: p }),
        ]),
      ),
    );
    if (hits.length === 0) results.append(el("li", { className: "muted", textContent: "No matching notes." }));
  };
  const search = el("input", {
    type: "search",
    className: "picker-search",
    placeholder: "Filter notes",
    oninput: () => fill(search.value),
  });
  root.replaceChildren(
    el("div", { className: "preview picker" }, [
      el("p", { className: "status", textContent: "The host did not send a note. Pick one:" }),
      search,
      results,
    ]),
  );
  fill("");
}

app.ontoolinput = (params) => {
  const path = params.arguments?.path;
  if (typeof path === "string" && path) inputPath = path;
};

app.ontoolresult = (result) => {
  gotResult = true;
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
setTimeout(() => {
  if (gotResult) return;
  if (!connected) {
    showStatus("The host did not connect to this view.", true);
    return;
  }
  if (inputPath) void open(inputPath, false);
  else void showPicker();
}, FALLBACK_MS);
await app.connect();
connected = true;
applyContext(app.getHostContext());
