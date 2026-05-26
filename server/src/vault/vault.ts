import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import {
  assertMarkdown,
  basename,
  normalizeRel,
  parentDir,
  relFromAbs,
  safeJoin,
} from "./paths";
import { VaultError } from "./types";
import type { NoteData, StatInfo, TreeNode } from "./types";

const TRASH_REL = ".brain/trash";
const BRAIN_REL = ".brain";
const MEDIA_DIR = ".media";

const SKIP_DIRS = new Set([".brain", ".git", "node_modules"]);

export type MutationKind = "write" | "delete" | "rename" | "media" | "folder-create" | "folder-delete";
export interface MutationEvent {
  kind: MutationKind;
  path: string;
  extra?: string;
}
export type MutationListener = (event: MutationEvent) => void;

export class Vault {
  private listeners = new Set<MutationListener>();

  constructor(public readonly root: string) {}

  onMutation(l: MutationListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private notify(kind: MutationKind, path: string, extra?: string): void {
    for (const l of this.listeners) {
      try {
        l({ kind, path, extra });
      } catch {
        // ignore listener errors
      }
    }
  }

  async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  abs(rel: string): string {
    return safeJoin(this.root, rel);
  }

  async stat(rel: string): Promise<StatInfo> {
    try {
      const s = await stat(this.abs(rel));
      return { exists: true, mtime: s.mtimeMs, isDir: s.isDirectory() };
    } catch {
      return { exists: false, mtime: 0, isDir: false };
    }
  }

  async readNote(rel: string): Promise<NoteData> {
    assertMarkdown(rel);
    const abs = this.abs(rel);
    try {
      const [content, s] = await Promise.all([
        readFile(abs, "utf8"),
        stat(abs),
      ]);
      return { path: normalizeRel(rel), content, mtime: s.mtimeMs };
    } catch (e) {
      throw new VaultError(`note not found: ${rel}`, "NOT_FOUND");
    }
  }

  async writeNote(rel: string, content: string): Promise<NoteData> {
    assertMarkdown(rel);
    const abs = this.abs(rel);
    await mkdir(dirname(abs), { recursive: true });
    await atomicWrite(abs, content);
    const s = await stat(abs);
    const path = normalizeRel(rel);
    this.notify("write", path);
    return { path, content, mtime: s.mtimeMs };
  }

  async deleteNote(rel: string): Promise<string> {
    assertMarkdown(rel);
    const trashed = await this.trashPath(rel, false);
    this.notify("delete", normalizeRel(rel), trashed);
    return trashed;
  }

  async renameNote(from: string, to: string): Promise<void> {
    assertMarkdown(from);
    assertMarkdown(to);
    const fromAbs = this.abs(from);
    const toAbs = this.abs(to);
    const toStat = await safeStat(toAbs);
    if (toStat?.isFile()) {
      throw new VaultError(`target exists: ${to}`, "EXISTS");
    }
    await mkdir(dirname(toAbs), { recursive: true });
    await rename(fromAbs, toAbs);
    this.notify("rename", normalizeRel(to), normalizeRel(from));
  }

  async mkdirFolder(rel: string): Promise<void> {
    const norm = normalizeRel(rel);
    if (norm === "") return;
    await mkdir(this.abs(norm), { recursive: true });
    this.notify("folder-create", norm);
  }

  async deleteFolder(rel: string): Promise<string> {
    const norm = normalizeRel(rel);
    if (norm === "" || norm.startsWith(BRAIN_REL)) {
      throw new VaultError("refuse delete root/brain", "INVALID_PATH");
    }
    const trashed = await this.trashPath(norm, true);
    this.notify("folder-delete", norm, trashed);
    return trashed;
  }

  async listTree(): Promise<TreeNode> {
    const folders: string[] = [];
    const notes: string[] = [];
    await walk(this.root, "", folders, notes);
    folders.sort();
    notes.sort();
    return { folders, notes };
  }

  async listAllNotes(): Promise<string[]> {
    const { notes } = await this.listTree();
    return notes;
  }

  mediaPathFor(noteRel: string, fileName: string): string {
    assertMarkdown(noteRel);
    const safeName = sanitizeFileName(fileName);
    const dir = parentDir(noteRel);
    return posix.join(dir, MEDIA_DIR, safeName);
  }

  async writeMedia(
    noteRel: string,
    fileName: string,
    bytes: Uint8Array | ArrayBuffer,
  ): Promise<string> {
    const rel = this.mediaPathFor(noteRel, fileName);
    const abs = this.abs(rel);
    await mkdir(dirname(abs), { recursive: true });
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await atomicWriteBytes(abs, buf);
    this.notify("media", rel);
    return rel;
  }

  async listTrash(): Promise<Array<{ path: string; mtime: number; isDir: boolean }>> {
    const trashAbs = this.abs(TRASH_REL);
    try {
      const tsEntries = await readdir(trashAbs, { withFileTypes: true });
      const out: Array<{ path: string; mtime: number; isDir: boolean }> = [];
      for (const ts of tsEntries) {
        if (!ts.isDirectory()) continue;
        const tsAbs = posix.join(trashAbs, ts.name);
        await collectTrash(tsAbs, `${TRASH_REL}/${ts.name}`, out);
      }
      out.sort((a, b) => b.mtime - a.mtime);
      return out;
    } catch {
      return [];
    }
  }

  async restoreFromTrash(trashRel: string): Promise<string> {
    const norm = normalizeRel(trashRel);
    if (!norm.startsWith(`${TRASH_REL}/`)) {
      throw new VaultError("not a trash path", "INVALID_PATH");
    }
    const tail = norm.slice(TRASH_REL.length + 1);
    const slash = tail.indexOf("/");
    if (slash < 0) throw new VaultError("trash path missing stamp", "INVALID_PATH");
    const original = tail.slice(slash + 1);
    const srcAbs = this.abs(norm);
    const destAbs = this.abs(original);
    const destStat = await safeStat(destAbs);
    if (destStat) throw new VaultError(`target exists: ${original}`, "EXISTS");
    await mkdir(dirname(destAbs), { recursive: true });
    await rename(srcAbs, destAbs);
    this.notify("write", original, "restore");
    return original;
  }

  async readMedia(rel: string): Promise<Uint8Array> {
    const abs = this.abs(rel);
    try {
      return new Uint8Array(await readFile(abs));
    } catch {
      throw new VaultError(`media not found: ${rel}`, "NOT_FOUND");
    }
  }

  private async trashPath(rel: string, isDir: boolean): Promise<string> {
    const abs = this.abs(rel);
    const s = await safeStat(abs);
    if (!s) throw new VaultError(`not found: ${rel}`, "NOT_FOUND");
    if (isDir && !s.isDirectory()) {
      throw new VaultError(`not a directory: ${rel}`, "INVALID_PATH");
    }
    if (!isDir && !s.isFile()) {
      throw new VaultError(`not a file: ${rel}`, "INVALID_PATH");
    }
    const ts = stamp();
    const trashRel = posix.join(TRASH_REL, ts, normalizeRel(rel));
    const trashAbs = this.abs(trashRel);
    await mkdir(dirname(trashAbs), { recursive: true });
    await rename(abs, trashAbs);
    return trashRel;
  }
}

async function collectTrash(
  abs: string,
  rel: string,
  out: Array<{ path: string; mtime: number; isDir: boolean }>,
): Promise<void> {
  const entries = await readdir(abs, { withFileTypes: true });
  for (const ent of entries) {
    const childAbs = `${abs}/${ent.name}`;
    const childRel = `${rel}/${ent.name}`;
    const s = await stat(childAbs).catch(() => null);
    if (!s) continue;
    if (ent.isDirectory()) {
      out.push({ path: childRel, mtime: s.mtimeMs, isDir: true });
      await collectTrash(childAbs, childRel, out);
    } else if (ent.isFile()) {
      out.push({ path: childRel, mtime: s.mtimeMs, isDir: false });
    }
  }
}

async function walk(
  root: string,
  rel: string,
  folders: string[],
  notes: string[],
): Promise<void> {
  const abs = rel === "" ? root : join(root, rel);
  const entries = await readdir(abs, { withFileTypes: true });
  for (const ent of entries) {
    const name = ent.name;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (name === MEDIA_DIR) continue;
      const childRel = rel === "" ? name : `${rel}/${name}`;
      folders.push(childRel);
      await walk(root, childRel, folders, notes);
    } else if (ent.isFile()) {
      if (!name.toLowerCase().endsWith(".md")) continue;
      const childRel = rel === "" ? name : `${rel}/${name}`;
      notes.push(childRel);
    }
  }
}

async function atomicWrite(abs: string, content: string): Promise<void> {
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, "utf8");
  try {
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

async function atomicWriteBytes(abs: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, bytes);
  try {
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

async function safeStat(abs: string) {
  try {
    return await stat(abs);
  } catch {
    return null;
  }
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "-" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds()) +
    "-" +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

function sanitizeFileName(name: string): string {
  if (
    name === "" ||
    name === "." ||
    name === ".." ||
    name.includes("\0") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.startsWith(".")
  ) {
    throw new VaultError("invalid filename", "INVALID_PATH");
  }
  return name;
}

export { TRASH_REL, BRAIN_REL, MEDIA_DIR };
