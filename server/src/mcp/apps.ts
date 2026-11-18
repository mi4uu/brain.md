import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { VaultIndex } from "../index/index";
import { readWebAsset } from "../web/serve";

export const NOTE_VIEW_URI = "ui://brainmd/note.html";

export type ViewLoader = (name: string) => Promise<string | null>;

export const webViewLoader: ViewLoader = async (name) => {
  const data = await readWebAsset(`mcp-apps/${name}.html`);
  return data ? new TextDecoder().decode(data) : null;
};

export interface AppViews {
  note: string | null;
}

export async function loadViews(loader: ViewLoader): Promise<AppViews> {
  return { note: await loader("note").catch(() => null) };
}

// Hosts without MCP Apps ignore `_meta.ui`, and the server cannot gate on
// the client's capability because the transport is stateless: initialize
// and tools/list arrive on different McpServer instances. So the tool
// result itself never changes; the view parses the same text content.
export function noteToolMeta(views: AppViews): { _meta?: Record<string, unknown> } {
  if (!views.note) return {};
  return { _meta: { ui: { resourceUri: NOTE_VIEW_URI }, "ui/resourceUri": NOTE_VIEW_URI } };
}

export const MODEL_ONLY_META = { _meta: { ui: { visibility: ["model"] } } };

export function appResourceContents(views: AppViews) {
  if (!views.note) return null;
  return {
    uri: NOTE_VIEW_URI,
    mimeType: RESOURCE_MIME_TYPE,
    text: views.note,
    _meta: { ui: { prefersBorder: true } },
  };
}

// Everything the note view needs for its first paint, so a host that asks
// the user to approve each app-initiated call (OpenClaw does) shows the
// note with zero extra calls. Lives in the result's _meta, which hosts keep
// out of the model's context; `content` stays exactly what it was.
export const NOTE_VIEW_META_KEY = "brainmd/note-view";

export interface NoteViewData {
  backlinks: Array<{ from: string; lineNo: number; context: string; embed: boolean }>;
  links: Record<string, string | null>;
}

export function noteViewData(index: VaultIndex, path: string, allowed: (path: string) => boolean): NoteViewData {
  const links: Record<string, string | null> = Object.create(null);
  for (const l of index.get(path)?.outLinks ?? []) {
    if (Object.hasOwn(links, l.targetLower)) continue;
    links[l.targetLower] = index.resolveAny(l.targetLower).matches.find(allowed) ?? null;
  }
  return { backlinks: index.backlinks(path, allowed), links };
}
