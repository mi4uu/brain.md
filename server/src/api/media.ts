import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import { asError } from "./errors";
import { decodeWildcard } from "./wildcard";
import { requireRead, requireWrite } from "./perm-guard";
import { normalizeRel, basename } from "../vault/paths";
import { VaultError } from "../vault/types";

// Extensions the web preview renders inline (img/audio/video/pdf elements,
// see web/src/renderer/render.ts's MEDIA_EXT) and that can't execute script
// when loaded directly in a browser tab. Everything else, known attachment
// type or not, gets served as a forced download with a sandboxed CSP: a
// vault can hold attachments of any kind, and this route must serve them
// without guessing whether a given extension is "supported", but an HTML,
// XML or similarly script-capable file must never render as if it were
// this origin's own page.
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
const AUDIO_EXT = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "weba"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "mkv", "avi"]);
const PDF_EXT = new Set(["pdf"]);
const SAFE_INLINE_EXT = new Set([...IMAGE_EXT, ...AUDIO_EXT, ...VIDEO_EXT, ...PDF_EXT]);

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  flac: "audio/flac",
  aac: "audio/aac",
  opus: "audio/opus",
  weba: "audio/webm",
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  xhtml: "application/xhtml+xml",
  json: "application/json",
  txt: "text/plain",
};

function extOf(rel: string): string {
  return basename(rel).split(".").pop()?.toLowerCase() ?? "";
}

function mimeFor(ext: string): string {
  return MIME[ext] ?? "application/octet-stream";
}

// Builds a Content-Disposition header that survives non-ASCII filenames
// without letting one inject a stray quote/CR/LF into the header value.
function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// /api/media-raw is for actual vault attachments, never control files.
// Without this, a path like .brain/settings.json or .brain/trash/... passed
// folder permissions trivially (they resolve against the ".brain" folder,
// which has no override) and disclosed its embedder apiKey despite the
// /api/settings redaction, plus anything else sitting in .brain or .git.
function assertMediaPath(rel: string): void {
  const norm = normalizeRel(rel);
  const segments = norm.split("/").filter(Boolean);
  if (segments.some((s) => s.startsWith(".") && s !== ".media")) {
    throw new VaultError("not a media path", "FORBIDDEN");
  }
}

export function mediaRoutes(vault: Vault) {
  return new Elysia()
    .post(
      "/api/media/*",
      async ({ params, body, set, request }) => {
        const noteRel = decodeWildcard((params as { "*": string })["*"]);
        try {
          await requireWrite(vault, request, noteRel);
          const file = body.file;
          if (!(file instanceof File)) {
            set.status = 400;
            return { error: "file field required" };
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const rel = await vault.writeMedia(noteRel, file.name, bytes);
          return { url: `/api/media-raw/${rel}`, path: rel, name: file.name };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({ file: t.File() }),
      },
    )
    .get("/api/media-raw/*", async ({ params, set, request }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        assertMediaPath(rel);
        await requireRead(vault, request, rel);
        const bytes = await vault.readMedia(rel);
        const ext = extOf(rel);
        const safe = SAFE_INLINE_EXT.has(ext);
        set.headers["content-type"] = mimeFor(ext);
        set.headers["cache-control"] = "private, max-age=3600";
        set.headers["x-content-type-options"] = "nosniff";
        if (!safe) {
          set.headers["content-security-policy"] =
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
          // svg is the one unsafe-by-default type the preview still embeds
          // directly via <img>; forcing a download there would break it.
          // Everything else in this branch (html, xml, zip, docx, …) is
          // never rendered inline, so it downloads instead of navigating.
          if (ext !== "svg") {
            set.headers["content-disposition"] = attachmentDisposition(basename(rel));
          }
        }
        return new Response(bytes as unknown as BodyInit);
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    });
}
