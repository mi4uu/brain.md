import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { VaultIndex } from "../index/index";
import { readWebAsset } from "../web/serve";

export const NOTE_VIEW_URI = "ui://brainmd/note.html";
export const GRAPH_VIEW_URI = "ui://brainmd/graph.html";

export type ViewLoader = (name: string) => Promise<string | null>;

export const webViewLoader: ViewLoader = async (name) => {
  const data = await readWebAsset(`mcp-apps/${name}.html`);
  return data ? new TextDecoder().decode(data) : null;
};

export interface AppViews {
  note: string | null;
  graph: string | null;
}

export async function loadViews(loader: ViewLoader): Promise<AppViews> {
  const [note, graph] = await Promise.all([loader("note").catch(() => null), loader("graph").catch(() => null)]);
  return { note, graph };
}

function uiMeta(uri: string): { _meta: Record<string, unknown> } {
  return { _meta: { ui: { resourceUri: uri }, "ui/resourceUri": uri } };
}

// Hosts without MCP Apps ignore `_meta.ui`, and the server cannot gate on
// the client's capability because the transport is stateless: initialize
// and tools/list arrive on different McpServer instances. So the tool
// result itself never changes; the view parses the same text content.
export function noteToolMeta(views: AppViews): { _meta?: Record<string, unknown> } {
  return views.note ? uiMeta(NOTE_VIEW_URI) : {};
}

export function graphToolMeta(views: AppViews): { _meta?: Record<string, unknown> } {
  return views.graph ? uiMeta(GRAPH_VIEW_URI) : {};
}

export const MODEL_ONLY_META = { _meta: { ui: { visibility: ["model"] } } };

export interface AppResource {
  name: string;
  description: string;
  uri: string;
  mimeType: string;
  text: string;
  _meta: Record<string, unknown>;
}

export function appResources(views: AppViews): AppResource[] {
  const out: AppResource[] = [];
  if (views.note) {
    out.push({
      name: "note-view",
      description: "MCP Apps view for read_note: rendered note with wikilinks and backlinks",
      uri: NOTE_VIEW_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: views.note,
      _meta: { ui: { prefersBorder: true } },
    });
  }
  if (views.graph) {
    out.push({
      name: "graph-view",
      description: "MCP Apps view for graph_view: interactive graph of notes and wikilinks",
      uri: GRAPH_VIEW_URI,
      mimeType: RESOURCE_MIME_TYPE,
      text: views.graph,
      _meta: { ui: { prefersBorder: true } },
    });
  }
  return out;
}

// Everything the note view needs for its first paint, so a host that asks
// the user to approve each app-initiated call (OpenClaw does) shows the
// note with zero extra calls. Lives in the result's _meta, which hosts keep
// out of the model's context; `content` stays exactly what it was.
export const NOTE_VIEW_META_KEY = "brainmd/note-view";

export interface NoteViewData {
  backlinks: Array<{ from: string; lineNo: number; context: string; embed: boolean }>;
  links: Record<string, string | null>;
  truncated?: true;
}

// Keeps a heavily linked note's read_note result small; the view says when
// the list was cut.
const MAX_BACKLINKS = 100;
const MAX_CONTEXT = 200;

export function noteViewData(index: VaultIndex, path: string, allowed: (path: string) => boolean): NoteViewData {
  const links: Record<string, string | null> = Object.create(null);
  for (const l of index.get(path)?.outLinks ?? []) {
    if (Object.hasOwn(links, l.targetLower)) continue;
    const to = index.resolveLink(path, l.target);
    links[l.targetLower] = to && allowed(to) ? to : null;
  }
  const all = index.backlinks(path, allowed);
  const backlinks = all
    .slice(0, MAX_BACKLINKS)
    .map((b) => (b.context.length > MAX_CONTEXT ? { ...b, context: `${b.context.slice(0, MAX_CONTEXT)}…` } : b));
  return all.length > MAX_BACKLINKS ? { backlinks, links, truncated: true } : { backlinks, links };
}

// The graph view's nodes and links ride in _meta like the note view's data.
// The cap keeps one result under a few hundred KB on large vaults.
export const GRAPH_VIEW_META_KEY = "brainmd/graph-view";
export const GRAPH_VIEW_MAX_NODES = 3000;
