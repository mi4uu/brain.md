import { Elysia, t } from "elysia";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";
import { normalizeRel } from "../vault/paths";
import { asError } from "./errors";

interface FolderMeta {
  version: 1;
  icons: Record<string, string>;
  colors: Record<string, string>;
}

const META_REL = ".brain/folder-meta.json";

async function load(vault: Vault): Promise<FolderMeta> {
  try {
    const raw = await readFile(vault.abs(META_REL), "utf8");
    const parsed = JSON.parse(raw) as FolderMeta;
    return {
      version: 1,
      icons: parsed.icons ?? {},
      colors: parsed.colors ?? {},
    };
  } catch {
    return { version: 1, icons: {}, colors: {} };
  }
}

async function save(vault: Vault, meta: FolderMeta): Promise<void> {
  const abs = vault.abs(META_REL);
  await mkdir(dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(meta, null, 2));
  try {
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

export function metaRoutes(vault: Vault) {
  return new Elysia({ prefix: "/api/folder-meta" })
    .get("/", async () => load(vault))
    .post(
      "/",
      async ({ body, set }) => {
        try {
          const meta = await load(vault);
          const norm = normalizeRel(body.path);
          if (norm === "") {
            set.status = 400;
            return { error: "root folder cannot be customised" };
          }
          if (body.icon === null || body.icon === undefined) {
            delete meta.icons[norm];
          } else {
            meta.icons[norm] = body.icon;
          }
          if (body.color === null) {
            delete meta.colors[norm];
          } else if (body.color !== undefined) {
            meta.colors[norm] = body.color;
          }
          await save(vault, meta);
          return { ok: true, meta };
        } catch (e) {
          const { status, body: err } = asError(e);
          set.status = status;
          return err;
        }
      },
      {
        body: t.Object({
          path: t.String(),
          icon: t.Optional(t.Union([t.String(), t.Null()])),
          color: t.Optional(t.Union([t.String(), t.Null()])),
        }),
      },
    );
}
