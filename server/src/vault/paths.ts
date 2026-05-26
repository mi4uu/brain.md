import { resolve, sep, posix, isAbsolute, normalize } from "node:path";
import { VaultError } from "./types";

export function normalizeRel(rel: string): string {
  if (typeof rel !== "string") {
    throw new VaultError("path must be string", "INVALID_PATH");
  }
  if (rel.includes("\0")) {
    throw new VaultError("null byte in path", "INVALID_PATH");
  }
  let r = rel.replace(/\\/g, "/").trim();
  while (r.startsWith("/")) r = r.slice(1);
  if (r === "" || r === ".") return "";
  const norm = posix.normalize(r);
  if (norm.startsWith("..") || norm === "..") {
    throw new VaultError("path traversal", "TRAVERSAL");
  }
  return norm;
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
