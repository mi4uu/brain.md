import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join } from "node:path";
import { ASSETS } from "./assets";
import { VERSION } from "../version";

// Three-tier web client resolver:
//   1. **Embedded**     — ASSETS map populated by scripts/gen-web-assets.ts
//                         before `bun build --compile`. Files are bundled
//                         into the binary; Bun.file() reads them directly.
//   2. **Local disk**   — web/dist/ next to the cwd (dev workflow after
//                         `bun --cwd web run build`).
//   3. **GitHub cache** — last-resort download from a GitHub Release into
//                         `$XDG_CACHE_HOME/brain.md/web/<version>/`. Lets
//                         someone clone the repo, run `bun start` and have
//                         the UI work without building the frontend first.

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// Where Tier 3 caches downloaded bundles.
function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  const base = xdg && xdg !== "" ? xdg : join(homedir(), ".cache");
  return join(base, "brain.md", "web", VERSION);
}

interface Resolver {
  kind: "embedded" | "disk" | "cache" | "none";
  read(path: string): Promise<Uint8Array | null>;
  has(path: string): Promise<boolean>;
}

function embeddedResolver(): Resolver | null {
  if (Object.keys(ASSETS).length === 0) return null;
  return {
    kind: "embedded",
    async has(p) {
      return ASSETS[p] !== undefined;
    },
    async read(p) {
      const handle = ASSETS[p];
      if (!handle) return null;
      return new Uint8Array(await Bun.file(handle).arrayBuffer());
    },
  };
}

function diskResolver(dir: string): Resolver {
  return {
    kind: "disk",
    async has(p) {
      return existsSync(join(dir, p));
    },
    async read(p) {
      const abs = join(dir, p);
      if (!existsSync(abs)) return null;
      return readFile(abs);
    },
  };
}

async function downloadAndExtract(target: string): Promise<boolean> {
  await mkdir(target, { recursive: true });
  const url = `https://github.com/mi4uu/brain.md/releases/download/v${VERSION}/web-dist.tar.gz`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[web] download from ${url} failed: ${res.status} ${res.statusText}`,
      );
      return false;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const tarPath = join(target, "web-dist.tar.gz");
    await writeFile(tarPath, buf);
    // Use system tar (POSIX + Windows 10+).
    const proc = Bun.spawn(["tar", "-xzf", tarPath, "-C", target], {
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      console.warn(`[web] tar extract failed (exit ${code}): ${err}`);
      return false;
    }
    return existsSync(join(target, "index.html"));
  } catch (e) {
    console.warn("[web] download fallback failed:", e);
    return false;
  }
}

async function resolveWeb(): Promise<Resolver> {
  // Tier 1
  const embedded = embeddedResolver();
  if (embedded) {
    console.log(`[web] serving ${Object.keys(ASSETS).length} embedded assets`);
    return embedded;
  }
  // Tier 2
  const candidates = [
    process.env.BRAIN_WEB_DIR?.trim() || "",
    join(process.cwd(), "web", "dist"),
    join(process.cwd(), "..", "web", "dist"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) {
      console.log(`[web] serving from ${c}`);
      return diskResolver(c);
    }
  }
  // Tier 3
  const cache = cacheDir();
  if (existsSync(join(cache, "index.html"))) {
    console.log(`[web] serving from cache ${cache}`);
    return diskResolver(cache);
  }
  console.log(`[web] downloading bundle for v${VERSION} → ${cache}`);
  const ok = await downloadAndExtract(cache);
  if (ok) {
    console.log(`[web] cached at ${cache}`);
    return diskResolver(cache);
  }
  console.warn(
    `[web] no web client available. Run \`bun --cwd web run build\`, ` +
      `download the binary from GitHub Releases, or set BRAIN_WEB_DIR.`,
  );
  return { kind: "none", async has() { return false; }, async read() { return null; } };
}

let resolverPromise: Promise<Resolver> | undefined;
function getResolver(): Promise<Resolver> {
  if (!resolverPromise) resolverPromise = resolveWeb();
  return resolverPromise;
}

// Mount as a low-priority catch-all. Must be called AFTER all /api/* and
// /mcp/* routes. Mutates `app` in place — `app` is typed as `unknown`
// because Elysia's deeply-parametrised type leaks into every chained
// route otherwise.
export async function mountEmbeddedWeb(app: unknown): Promise<void> {
  // Warm the resolver so the first request doesn't pay the download cost.
  const r = await getResolver();
  if (r.kind === "none") return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = app as any;
  a.get("/*", async ({ params, set }: { params: { "*"?: string }; set: { headers: Record<string, string>; status?: number } }) => {
    const raw = params["*"] ?? "";
    const cleaned = raw.replace(/^\/+/, "");
    const tryPaths = cleaned === "" ? ["index.html"] : [cleaned, "index.html"];
    for (const p of tryPaths) {
      const data = await r.read(p);
      if (data) {
        set.headers["content-type"] = mimeFor(p);
        set.headers["cache-control"] =
          p === "index.html"
            ? "no-cache"
            : "public, max-age=31536000, immutable";
        return new Response(data as BodyInit);
      }
    }
    set.status = 404;
    return "Not Found";
  });
}
