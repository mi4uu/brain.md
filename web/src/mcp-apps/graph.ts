import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { GraphEngine, type GraphInput } from "../graph/engine";
import "../styles/tokens.css";
import "./graph-view.css";

interface ViewData extends GraphInput {
  center: string | null;
  truncated?: boolean;
}

interface Args {
  center?: string;
  depth?: number;
  folder?: string;
}

const VIEW_META_KEY = "brainmd/graph-view";
const FALLBACK_MS = 6000;

type ToolResult = { content?: Array<{ type: string; text?: string }>; isError?: boolean; _meta?: Record<string, unknown> };

const app = new App({ name: "brain.md graph", version: "1" }, {}, { autoResize: true });
const root = document.getElementById("root") as HTMLElement;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) node.append(c);
  return node;
}

function textOf(r: ToolResult): string {
  return r.content?.find((c) => c.type === "text")?.text ?? "";
}

function dataOf(r: ToolResult): ViewData | null {
  const d = r._meta?.[VIEW_META_KEY] as ViewData | undefined;
  return d && Array.isArray(d.nodes) && Array.isArray(d.links) ? d : null;
}

function titleOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

const summary = el("p", { className: "summary" });
const back = el("button", { type: "button", className: "btn", textContent: "Back", disabled: true });
const ask = el("button", { type: "button", className: "btn", textContent: "Open in chat", disabled: true });
const status = el("p", { className: "status", textContent: "Waiting for the graph…" });
const host = el("div", { className: "canvas" });
root.replaceChildren(
  el("div", { className: "view" }, [el("div", { className: "bar" }, [back, summary, ask]), status, host]),
);

const history: Args[] = [];
let current: Args = {};
let selected: string | null = null;
let seq = 0;
let gotResult = false;
let navigated = false;
let inputArgs: Args = {};

const engine = new GraphEngine(host, {
  onOpen: (id) => {
    selected = id;
    ask.disabled = false;
    ask.textContent = `Open “${titleOf(id)}” in chat`;
    if (id !== current.center) void load({ center: id, depth: 1 }, true);
  },
});

function show(r: ToolResult): void {
  const text = textOf(r);
  back.disabled = history.length === 0;
  if (r.isError) {
    status.textContent = text || "The graph could not be loaded.";
    status.classList.add("error");
    return;
  }
  const data = dataOf(r);
  summary.textContent = text.split("\n")[0] ?? "";
  if (!data) {
    status.textContent = "This host did not pass the graph data; the summary is above.";
    return;
  }
  status.textContent = data.truncated ? `Showing the first ${data.nodes.length} notes.` : "";
  status.classList.remove("error");
  engine.setOptions({ focusId: data.center, alwaysLabels: data.nodes.length <= 60 });
  engine.setData(data);
}

// History moves only when a load succeeds, so a failed or superseded
// click never leaves a dead Back entry.
async function load(args: Args, pushCurrent = false): Promise<void> {
  const token = ++seq;
  navigated = true;
  status.textContent = "Loading…";
  try {
    const r = (await app.callServerTool({ name: "graph_view", arguments: { ...args } })) as ToolResult;
    if (token !== seq) return;
    if (pushCurrent && !r.isError) history.push(current);
    if (!r.isError) current = args;
    show(r);
  } catch (err) {
    if (token === seq) status.textContent = `Could not load the graph: ${(err as Error).message}`;
  }
}

back.onclick = () => {
  const prev = history[history.length - 1];
  if (!prev) return;
  void load(prev).then(() => {
    if (current === prev) history.pop();
    back.disabled = history.length === 0;
  });
};

ask.onclick = () => {
  if (!selected) return;
  const refused = () => {
    status.textContent = "This host does not let the view send messages.";
  };
  void app
    .sendMessage({ role: "user", content: [{ type: "text", text: `Open the note ${selected} from brain.md.` }] })
    .then((res) => {
      if ((res as { isError?: boolean }).isError) refused();
    })
    .catch(refused);
};

function applyContext(ctx: McpUiHostContext | undefined): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

app.onhostcontextchanged = (ctx) => applyContext({ ...app.getHostContext(), ...ctx });
app.ontoolinput = (params) => {
  inputArgs = (params.arguments ?? {}) as Args;
};
app.ontoolresult = (r) => {
  gotResult = true;
  // A result that arrives after the user already moved around (the
  // fallback ran first) must not pull the view back.
  if (navigated) return;
  current = inputArgs;
  show(r as ToolResult);
};

let connected = false;
let timedOut = false;
const fallback = () => {
  if (!gotResult) void load(inputArgs);
};
setTimeout(() => {
  timedOut = true;
  if (connected) fallback();
}, FALLBACK_MS);
await app.connect();
connected = true;
applyContext(app.getHostContext());
if (timedOut) fallback();
