import { resolve, sep, posix, isAbsolute, relative, join } from "node:path";
import { lstat } from "node:fs/promises";
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
// passes containment even when `public/link` is a symlink, because the
// string never leaves `vault/...`. The OS resolves symlinks when it
// actually opens the file, which is the escape, and it's an escape even
// when the symlink's target is also inside the vault: a symlink can alias
// a path a caller may read into a path they may not (folder permissions,
// git restore targets, …), which no amount of resolving-and-recomparing
// against the vault root catches. Obsidian vaults don't rely on symlinks,
// so the simplest safe rule is to reject any symlink anywhere on the path,
// full stop, rather than try to authorise one. Call this right before the
// actual read/write, after safeJoin/assertSafePath.
export async function assertRealContainment(vaultDir: string, abs: string): Promise<void> {
  const base = resolve(vaultDir);
  const rel = relative(base, abs);
  if (rel === "") return;
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new VaultError("path escapes vault", "TRAVERSAL");
  }
  let cur = base;
  for (const part of rel.split(sep)) {
    if (part === "") continue;
    cur = join(cur, part);
    let st;
    try {
      st = await lstat(cur);
    } catch (e) {
      if ((e as { code?: string }).code === "ENOENT") break; // rest doesn't exist yet (new file/dir)
      throw e;
    }
    if (st.isSymbolicLink()) {
      throw new VaultError("path escapes vault (symlink)", "TRAVERSAL");
    }
  }
}

export function assertMarkdown(rel: string): void {
  if (!rel.toLowerCase().endsWith(".md")) {
    throw new VaultError("not a markdown path", "NOT_MARKDOWN");
  }
}

// assertMarkdown only checks the suffix: a directory literally named
// "x.md" passes it, and a restore writing into that path (git.ts
// restore(), via `git checkout <sha> -- x.md`) would otherwise recurse
// into it rather than treating it as the single file it's supposed to
// be. Call this right before a restore actually runs, after
// assertSafePath/assertMarkdown, to reject that case against the real
// filesystem. A path that doesn't exist yet (ENOENT) is fine, there's
// nothing to recurse into.
export async function assertRestoreTargetIsFile(vaultDir: string, rel: string): Promise<void> {
  const abs = safeJoin(vaultDir, rel);
  let st;
  try {
    st = await lstat(abs);
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return;
    throw e;
  }
  if (st.isDirectory()) {
    throw new VaultError(`restore target is a directory, not a file: ${rel}`, "NOT_MARKDOWN");
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
