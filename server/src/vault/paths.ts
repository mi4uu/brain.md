import { resolve, sep, posix, isAbsolute, normalize, dirname, basename as pathBasename, join } from "node:path";
import { realpath } from "node:fs/promises";
import { VaultError } from "./types";

export function normalizeRel(rel: string): string {
  if (typeof rel !== "string") {
    throw new VaultError("path must be string", "INVALID_PATH");
  }
  if (rel.includes("\0")) {
    throw new VaultError("null byte in path", "INVALID_PATH");
  }
  // V42: vault is POSIX-only. Do NOT rewrite "\" → "/" — that would
  // silently corrupt filenames containing a literal backslash. assertSafeBasename
  // is the gate that prevents `\` (and other forbidden chars) entering basenames
  // at create/rename time.
  let r = rel.trim();
  while (r.startsWith("/")) r = r.slice(1);
  if (r === "" || r === ".") return "";
  const norm = posix.normalize(r);
  if (norm.startsWith("..") || norm === "..") {
    throw new VaultError("path traversal", "TRAVERSAL");
  }
  return norm;
}

// V42: forbidden in note + folder basenames (per-segment).
// `/` is a path separator (would split the path).
// `\` would historically have been rewritten to `/` by normalizeRel.
// `%` round-trips ambiguously through URL encoding.
// NUL/CR/LF break filesystem + HTTP layers.
// Leading `.` is reserved for vault control dirs (.brain, .media, .git).
const FORBIDDEN_CHARS = /[/\\%\x00\r\n]/;
export function assertSafeBasename(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new VaultError("name must be non-empty string", "INVALID_NAME");
  }
  if (FORBIDDEN_CHARS.test(name)) {
    throw new VaultError(
      `name contains forbidden character (one of / \\ % NUL CR LF): ${JSON.stringify(name)}`,
      "INVALID_NAME",
    );
  }
  if (name.startsWith(".")) {
    throw new VaultError(
      `name must not start with "." (reserved for control dirs): ${name}`,
      "INVALID_NAME",
    );
  }
  if (name.length > 200) {
    throw new VaultError("name too long (max 200 chars)", "INVALID_NAME");
  }
}

export function assertSafePath(rel: string): void {
  const norm = normalizeRel(rel);
  if (norm === "") return;
  for (const seg of norm.split("/")) {
    assertSafeBasename(seg);
  }
}

export function safeJoin(vaultDir: string, rel: string): string {
  if (isAbsolute(rel)) {
    throw new VaultError("absolute path not allowed", "INVALID_PATH");
  }
  const norm = normalizeRel(rel);
  const full = resolve(vaultDir, norm);
  const base = resolve(vaultDir) + sep;
  if (full !== resolve(vaultDir) && !full.startsWith(base)) {
    throw new VaultError("path escapes vault", "TRAVERSAL");
  }
  return full;
}

// safeJoin only checks the path lexically: `vault/public/link/secret.md`
// passes containment even when `public/link` is a symlink pointing outside
// the vault (or into a folder the caller has no permission for), because
// the string never leaves `vault/...`. The OS resolves symlinks when it
// actually opens the file, which is the escape. This walks up from the
// target to the nearest ancestor that exists, realpath()s that ancestor
// (fully resolving any symlink chain), and re-joins the remaining
// non-existent suffix — then checks the result is still inside the vault.
// Call this right before the actual read/write, after safeJoin/assertSafePath.
export async function assertRealContainment(vaultDir: string, abs: string): Promise<void> {
  const base = resolve(vaultDir);
  const baseReal = await realpath(base).catch(() => base);
  let cur = abs;
  const suffix: string[] = [];
  for (;;) {
    try {
      const real = await realpath(cur);
      const resolved = suffix.length > 0 ? join(real, ...suffix) : real;
      if (resolved !== baseReal && !resolved.startsWith(baseReal + sep)) {
        throw new VaultError("path escapes vault (symlink)", "TRAVERSAL");
      }
      return;
    } catch (e) {
      if (e instanceof VaultError) throw e;
      if ((e as { code?: string }).code !== "ENOENT") {
        // Any other I/O error (EACCES, ELOOP, …) — don't mask it as a pass.
        throw e;
      }
      const parent = dirname(cur);
      if (parent === cur) {
        // Walked off the filesystem root without finding an existing
        // ancestor — treat as escaped rather than looping forever.
        throw new VaultError("path escapes vault (symlink)", "TRAVERSAL");
      }
      suffix.unshift(pathBasename(cur));
      cur = parent;
    }
  }
}

export function assertMarkdown(rel: string): void {
  if (!rel.toLowerCase().endsWith(".md")) {
    throw new VaultError("not a markdown path", "NOT_MARKDOWN");
  }
}

export function relFromAbs(vaultDir: string, abs: string): string {
  const base = resolve(vaultDir);
  const a = resolve(abs);
  if (a === base) return "";
  if (!a.startsWith(base + sep)) {
    throw new VaultError("path outside vault", "TRAVERSAL");
  }
  return a.slice(base.length + 1).split(sep).join("/");
}

export function parentDir(rel: string): string {
  const norm = normalizeRel(rel);
  const idx = norm.lastIndexOf("/");
  return idx < 0 ? "" : norm.slice(0, idx);
}

export function basename(rel: string): string {
  const norm = normalizeRel(rel);
  const idx = norm.lastIndexOf("/");
  return idx < 0 ? norm : norm.slice(idx + 1);
}

export function basenameNoExt(rel: string): string {
  const b = basename(rel);
  const i = b.lastIndexOf(".");
  return i <= 0 ? b : b.slice(0, i);
}
