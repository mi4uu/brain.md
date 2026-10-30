import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
//                         Verified against the release's SHA256SUMS before
//                         extraction; refuses releases that don't have one.

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

// A note can contain attacker-controlled HTML (imported, synced, or
// written by an MCP agent) that reaches the DOM through the Markdown
// renderer. CSP is the backstop if that sanitisation ever has a gap:
// no inline/external script beyond our own bundle can run, nothing can
// be <object>/<embed>ed, and the page can't be framed or have its <base>
// hijacked. style-src allows 'unsafe-inline' because KaTeX and
// highlight.js generate inline styles; img-src allows data:/blob: for
// the same (KaTeX glyphs, pasted/rendered images).
export const CSP =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  // Markdown can embed remote https:// images; https: keeps those
  // rendering. media-src covers protected audio/video served as blob
  // URLs (web/src loads them that way when auth is on).
  "img-src 'self' data: blob: https:; " +
  "media-src 'self' blob:; " +
  "font-src 'self' data:; " +
  "connect-src 'self'; " +
  "worker-src 'self' blob:; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "frame-ancestors 'none'";

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

// Returns the expected sha256 for `filename` from a GitHub-style
// SHA256SUMS listing ("<hex>  <filename>" per line), or null if the
// file isn't listed.
export function expectedSha256(sums: string, filename: string): string | null {
  for (const line of sums.split("\n")) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m && m[2] === filename) return m[1] ?? null;
  }
  return null;
}

// An archive entry is safe to extract under `target` only if it stays
// inside it once resolved: no absolute path, no `..` segment.
export function isSafeTarEntry(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return false;
  return normalized.split("/").every((seg) => seg !== "..");
}

interface TarEntryInfo {
  typeChar: string;
  name: string;
  raw: string;
}

// Parses one line of `tar -tv` output (works for both GNU tar and
// macOS/bsdtar): a permission string whose first character is the entry
// type ('-' regular, 'd' directory, 'l' symlink, …), then owner/size/date
// columns, then the path: "-> target" for a symlink, "link to target"
// for a hardlink.
export function parseTarVerboseLine(line: string): TarEntryInfo {
  const typeChar = line[0] ?? "?";
  const arrowIdx = line.indexOf(" -> ");
  const linkIdx = line.indexOf(" link to ");
  const namePart = arrowIdx >= 0 ? line.slice(0, arrowIdx) : linkIdx >= 0 ? line.slice(0, linkIdx) : line;
  const fields = namePart.trim().split(/\s+/);
  return { typeChar, name: fields[fields.length - 1] ?? "", raw: line };
}

// Only plain files and directories are safe to extract. Symlinks and
// hardlinks (shown as "-> target" / "link to target" in verbose output,
// regardless of typeChar) could point outside the extraction directory
// or alias a file this process reads later; device/fifo/socket entries
// have no business in a web asset bundle at all.
export function isSafeTarEntryType(e: TarEntryInfo): boolean {
  if (e.typeChar !== "-" && e.typeChar !== "d") return false;
  if (e.raw.includes(" -> ") || e.raw.includes(" link to ")) return false;
  return true;
}

async function listTarEntriesVerbose(tarPath: string): Promise<TarEntryInfo[] | null> {
  const proc = Bun.spawn(["tar", "-tvzf", tarPath], { stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    console.warn(`[web] tar listing failed (exit ${code}): ${err}`);
    return null;
  }
  return out
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map(parseTarVerboseLine);
}

async function downloadAndExtract(target: string): Promise<boolean> {
  // Extract into an isolated staging directory first, and only move it
  // into `target` once everything has checked out. Extracting straight
  // into `target` would leave a half-extracted (or unsafely extracted)
  // tree in place on any failure partway through.
  const staging = `${target}.staging-${process.pid}-${Date.now()}`;
  await mkdir(staging, { recursive: true });
  const base = `https://github.com/mi4uu/brain.md/releases/download/v${VERSION}`;
  const archiveName = "web-dist.tar.gz";
  const url = `${base}/${archiveName}`;
  const sumsUrl = `${base}/SHA256SUMS`;
  try {
    const sumsRes = await fetch(sumsUrl);
    if (!sumsRes.ok) {
      console.warn(
        `[web] no SHA256SUMS for v${VERSION} (${sumsRes.status}). ` +
          `Refusing to fetch an unverified web bundle.`,
      );
      return false;
    }
    const expected = expectedSha256(await sumsRes.text(), archiveName);
    if (!expected) {
      console.warn(
        `[web] SHA256SUMS for v${VERSION} has no entry for ${archiveName}. ` +
          `Refusing to fetch an unverified web bundle.`,
      );
      return false;
    }

    const res = await fetch(url);
    if (!res.ok) {
      console.warn(
        `[web] download from ${url} failed: ${res.status} ${res.statusText}`,
      );
      return false;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const actual = createHash("sha256").update(buf).digest("hex");
    if (actual !== expected) {
      console.warn(
        `[web] checksum mismatch for ${archiveName}: expected ${expected}, got ${actual}.`,
      );
      return false;
    }

    const tarPath = join(staging, archiveName);
    await writeFile(tarPath, buf);

    const entries = await listTarEntriesVerbose(tarPath);
    if (!entries) return false;
    const unsafeNames = entries.filter((e) => !isSafeTarEntry(e.name));
    if (unsafeNames.length > 0) {
      console.warn(
        `[web] refusing to extract ${archiveName}: unsafe paths ${unsafeNames.map((e) => e.name).join(", ")}`,
      );
      return false;
    }
    const unsafeTypes = entries.filter((e) => !isSafeTarEntryType(e));
    if (unsafeTypes.length > 0) {
      console.warn(
        `[web] refusing to extract ${archiveName}: non-regular entries ${unsafeTypes.map((e) => e.name).join(", ")}`,
      );
      return false;
    }

    // Use system tar (POSIX + Windows 10+).
    const proc = Bun.spawn(["tar", "-xzf", tarPath, "-C", staging], {
      stderr: "pipe",
    });
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      console.warn(`[web] tar extract failed (exit ${code}): ${err}`);
      return false;
    }
    if (!existsSync(join(staging, "index.html"))) return false;

    await rm(tarPath, { force: true });
    await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    return true;
  } catch (e) {
    console.warn("[web] download fallback failed:", e);
    return false;
  } finally {
    // Only still around on a failure path above (success already moved
    // it to `target`).
    await rm(staging, { recursive: true, force: true }).catch(() => {});
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
        if (p.endsWith(".html")) {
          set.headers["content-security-policy"] = CSP;
        }
        return new Response(data as BodyInit);
      }
    }
    set.status = 404;
    return "Not Found";
  });
}
