import { Elysia, t } from "elysia";
import type { Vault } from "../vault/vault";
import { asError } from "./errors";
import { decodeWildcard } from "./wildcard";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  json: "application/json",
  txt: "text/plain",
};

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export function mediaRoutes(vault: Vault) {
  return new Elysia()
    .post(
      "/api/media/*",
      async ({ params, body, set }) => {
        const noteRel = decodeWildcard((params as { "*": string })["*"]);
        try {
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
    .get("/api/media-raw/*", async ({ params, set }) => {
      const rel = decodeWildcard((params as { "*": string })["*"]);
      try {
        const bytes = await vault.readMedia(rel);
        set.headers["content-type"] = mimeFor(rel);
        set.headers["cache-control"] = "private, max-age=3600";
        return new Response(bytes as unknown as BodyInit);
      } catch (e) {
        const { status, body } = asError(e);
        set.status = status;
        return body;
      }
    });
}
