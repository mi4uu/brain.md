import {
  mkdir,
  open as fsOpen,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import { dirname, join, posix, resolve } from "node:path";
import {
  assertMarkdown,
  assertSafePath,
  assertSafeBasename,
  assertRealContainment,
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
  // folder-delete: every tracked file (relative, pre-trash) that was under
  // the deleted folder, notes AND non-markdown attachments alike, so index/
  // RAG/autocommit listeners can drop or stage each one individually
  // instead of only hearing about the folder's own path. index/RAG ignore
  // entries that aren't markdown; autocommit stages and attributes every
  // one of them.
  paths?: string[];
}
export type MutationListener = (event: MutationEvent) => void | Promise<void>;

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export class Vault {
  private listeners = new Set<MutationListener>();
  // Per-path mutation queue (V-concurrency): every write/delete/rename/
  // restore serialises on the path(s) it touches so concurrent callers
  // read-modify-write in turn instead of racing each other.
  private pathLocks = new Map<string, Promise<unknown>>();

  constructor(public readonly root: string) {}

  // Acquires the queue slot for every path in `paths` atomically (no await
  // between reading and replacing each slot), then runs `fn` once all prior
  // holders of any of those paths have finished. Locks are always taken in
  // sorted order so two callers locking the same pair of paths never
  // deadlock on each other.
  protected async withPathLock<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
    const sorted = Array.from(new Set(paths.map((p) => normalizeRel(p)))).sort();
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const waits: Array<Promise<unknown>> = [];
    for (const p of sorted) {
      waits.push(this.pathLocks.get(p) ?? Promise.resolve());
      this.pathLocks.set(p, gate);
    }
    await Promise.all(waits.map((w) => w.catch(() => {})));
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // Public wrapper so a caller spanning several notes (rename's backlink
  // patch pass) can hold the lock across a check-then-write on every one
  // of them at once, rather than locking each file separately and leaving
  // a window between checking permissions and writing where a concurrent
  // caller could change what's safe to write.
  async withNotesLocked<T>(paths: string[], fn: () => Promise<T>): Promise<T> {
    return this.withPathLock(paths, fn);
  }

  // Writes a note while the caller already holds its lock (via
  // withNotesLocked), skipping writeNoteChecked's own locking. Only safe
  // to call from inside that lock's callback.
  async writeNoteLocked(rel: string, content: string): Promise<NoteData> {
    assertMarkdown(rel);
    assertSafePath(rel);
    const abs = this.abs(rel);
    await assertRealContainment(this.root, abs);
    const path = normalizeRel(rel);
    await mkdir(dirname(abs), { recursive: true });
    await atomicWrite(abs, content);
    const s = await stat(abs);
    await this.notify("write", path);
    return { path, content, mtime: s.mtimeMs, revision: sha256Hex(content) };
  }

  onMutation(l: MutationListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  // Awaits any listener that returns a promise (VaultIndex.start() does,
  // so a write's response reflects the index update that just happened)
  // while listeners that intentionally fire-and-forget (RagPipeline.start()
  // doesn't block a note write on embedding) just run in the background.
  // A listener throwing or rejecting never breaks the mutation itself.
  private async notify(kind: MutationKind, path: string, extra?: string, paths?: string[]): Promise<void> {
    const event: MutationEvent = { kind, path, extra, paths };
    const pending: Array<Promise<unknown>> = [];
    for (const l of this.listeners) {
      try {
        const r = l(event);
        if (r && typeof (r as Promise<void>).then === "function") pending.push(r as Promise<void>);
      } catch {
        // ignore listener errors
      }
    }
    if (pending.length > 0) await Promise.allSettled(pending);
  }

  // Git restore (and anything else that writes straight to the filesystem
  // outside the Vault's own methods) uses this to funnel into the same
  // single notification point index/RAG already subscribe to.
  async notifyWrite(rel: string): Promise<void> {
    await this.notify("write", normalizeRel(rel));
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
    // Dot-dirs (.brain, .git, …) are control paths, not ordinary notes.
    // Without this, .brain/trash/<stamp>/secret/a.md reads straight through
    // with the trash entry's own (unrestricted) permission check instead of
    // the original note's, a way around folder perms. Dedicated endpoints
    // (trash.ts) that legitimately touch .brain/ go through Vault's other
    // methods, not readNote.
    assertSafePath(rel);
    const abs = this.abs(rel);
    await assertRealContainment(this.root, abs);
    try {
      const [content, s] = await Promise.all([
        readFile(abs, "utf8"),
        stat(abs),
      ]);
      return { path: normalizeRel(rel), content, mtime: s.mtimeMs, revision: sha256Hex(content) };
    } catch (e) {
      throw new VaultError(`note not found: ${rel}`, "NOT_FOUND");
    }
  }

  async writeNote(rel: string, content: string): Promise<NoteData> {
    const r = await this.writeNoteChecked(rel, content);
    if (!r.ok) {
      // writeNote() (no baseRevision) never conflicts, writeNoteChecked
      // only returns ok:false when a baseRevision mismatched.
      throw new VaultError("unexpected conflict", "IO");
    }
    return r.data;
  }

  // V-concurrency: optimistic concurrency for note writes. `baseRevision`,
  // when given, must match the sha256 of the content currently on disk or
  // the write is refused, the caller gets the current revision back
  // instead. Absent on-disk content (creating a new note) never conflicts
  // by itself; it only conflicts if the file has concurrently come into
  // existence with different content than the caller's baseRevision reflects.
  async writeNoteChecked(
    rel: string,
    content: string,
    baseRevision?: string,
  ): Promise<{ ok: true; data: NoteData } | { ok: false; revision: string | null }> {
    assertMarkdown(rel);
    assertSafePath(rel);
    const abs = this.abs(rel);
    await assertRealContainment(this.root, abs);
    const path = normalizeRel(rel);
    return this.withPathLock([path], async () => {
      const existing = await safeReadFile(abs);
      const currentRevision = existing === null ? null : sha256Hex(existing);
      // A caller that supplied baseRevision read the file at some point and
      // expects to be updating it, not creating it fresh. If it's gone
      // (deleted, or trashed, concurrently) that's a conflict, same as any
      // other revision mismatch, not licence to silently recreate it.
      if (baseRevision !== undefined && currentRevision !== baseRevision) {
        return { ok: false, revision: currentRevision };
      }
      await mkdir(dirname(abs), { recursive: true });
      await atomicWrite(abs, content);
      const s = await stat(abs);
      await this.notify("write", path);
      return { ok: true, data: { path, content, mtime: s.mtimeMs, revision: sha256Hex(content) } };
    });
  }

  // Read-modify-write under the same per-path lock as writeNote, so two
  // concurrent appends to the same note can't both read the old body and
  // overwrite each other's addition.
  async appendNote(rel: string, text: string): Promise<NoteData> {
    assertMarkdown(rel);
    assertSafePath(rel);
    const abs = this.abs(rel);
    await assertRealContainment(this.root, abs);
    const path = normalizeRel(rel);
    return this.withPathLock([path], async () => {
      const existing = await safeReadFile(abs);
      const body = existing ?? "";
      const joiner = body === "" ? "" : body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
      const next = body + joiner + text + (text.endsWith("\n") ? "" : "\n");
      await mkdir(dirname(abs), { recursive: true });
      await atomicWrite(abs, next);
      const s = await stat(abs);
      await this.notify("write", path);
      return { path, content: next, mtime: s.mtimeMs, revision: sha256Hex(next) };
    });
  }

  // General-purpose locked read-modify-write, used by backlink rewriting on
  // rename (index/rename.ts) so two renames patching the same note can't
  // both read the pre-patch body and have one's edit overwrite the other's.
  // `fn` returns the new content, or null to leave the note untouched.
  async mutateNote(
    rel: string,
    fn: (current: string | null) => string | null | Promise<string | null>,
  ): Promise<NoteData | null> {
    assertMarkdown(rel);
    assertSafePath(rel);
    const abs = this.abs(rel);
    await assertRealContainment(this.root, abs);
    const path = normalizeRel(rel);
    return this.withPathLock([path], async () => {
      const existing = await safeReadFile(abs);
      const next = await fn(existing);
      if (next === null) return null;
      await mkdir(dirname(abs), { recursive: true });
      await atomicWrite(abs, next);
      const s = await stat(abs);
      await this.notify("write", path);
      return { path, content: next, mtime: s.mtimeMs, revision: sha256Hex(next) };
    });
  }

  async deleteNote(rel: string): Promise<string> {
    assertMarkdown(rel);
    assertSafePath(rel);
    const path = normalizeRel(rel);
    return this.withPathLock([path], async () => {
      const trashed = await this.trashPath(rel, false);
      await this.notify("delete", path, trashed);
      return trashed;
    });
  }

  async renameNote(from: string, to: string): Promise<void> {
    assertMarkdown(from);
    assertMarkdown(to);
    // `from` may be a pathological pre-V42 file; only enforce on the target.
    assertSafePath(to);
    const fromPath = normalizeRel(from);
    const toPath = normalizeRel(to);
    await this.withPathLock([fromPath, toPath], async () => {
      const fromAbs = this.abs(fromPath);
      const toAbs = this.abs(toPath);
      await assertRealContainment(this.root, fromAbs);
      await assertRealContainment(this.root, toAbs);
      // Existence check + rename happen under the same lock on both paths,
      // so two concurrent renames onto the same target can't both pass the
      // check and have the second clobber the first's file.
      const toStat = await safeStat(toAbs);
      if (toStat?.isFile()) {
        throw new VaultError(`target exists: ${to}`, "EXISTS");
      }
      await mkdir(dirname(toAbs), { recursive: true });
      await rename(fromAbs, toAbs);
      await this.notify("rename", toPath, fromPath);
    });
  }

  async mkdirFolder(rel: string): Promise<void> {
    const norm = normalizeRel(rel);
    if (norm === "") return;
    assertSafePath(norm);
    const abs = this.abs(norm);
    await assertRealContainment(this.root, abs);
    await mkdir(abs, { recursive: true });
    await this.notify("folder-create", norm);
  }

  async deleteFolder(rel: string): Promise<string> {
    const norm = normalizeRel(rel);
    if (norm === "" || norm.startsWith(BRAIN_REL)) {
      throw new VaultError("refuse delete root/brain", "INVALID_PATH");
    }
    return this.withPathLock([norm], async () => {
      // Snapshot every tracked file under this folder before trashing it,
      // once trashed they live under .brain/trash/<stamp>/..., so this is
      // the only chance to tell listeners which concrete paths
      // disappeared. Every file, not just notes: listTree()/walk() skip
      // .media (it isn't shown in the note tree) and non-.md files, but
      // those are still real tracked files on disk, and autocommit needs
      // every one of them to stage and attribute the deletion per actor.
      const removedFiles: string[] = [];
      await collectAllFiles(this.abs(norm), norm, removedFiles);
      const trashed = await this.trashPath(norm, true);
      await this.notify("folder-delete", norm, trashed, removedFiles);
      return trashed;
    });
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
    await assertRealContainment(this.root, abs);
    await mkdir(dirname(abs), { recursive: true });
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await atomicWriteBytes(abs, buf);
    await this.notify("media", rel);
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
    return this.withPathLock([norm, original], () => this.restoreFromTrashLocked(norm, original));
  }

  private async restoreFromTrashLocked(norm: string, original: string): Promise<string> {
    const srcAbs = this.abs(norm);
    const destAbs = this.abs(original);
    await assertRealContainment(this.root, srcAbs);
    await assertRealContainment(this.root, destAbs);
    const destStat = await safeStat(destAbs);
    if (destStat) throw new VaultError(`target exists: ${original}`, "EXISTS");
    await mkdir(dirname(destAbs), { recursive: true });
    await rename(srcAbs, destAbs);
    const restoredStat = await stat(destAbs);
    if (restoredStat.isDirectory()) {
      // A single "write" on the folder's own path means nothing to the
      // index/RAG listeners (neither ends in .md), so every note the
      // restored folder contains stayed invisible to full-text and RAG
      // search until the next full rebuild. Emit one per note instead.
      const notes: string[] = [];
      await collectNoteFiles(destAbs, original, notes);
      await Promise.all(notes.map((p) => this.notify("write", p, "restore")));
    } else {
      await this.notify("write", original, "restore");
    }
    return original;
  }

  async readMedia(rel: string): Promise<Uint8Array> {
    const abs = this.abs(rel);
    try {
      await assertRealContainment(this.root, abs);
      return new Uint8Array(await readFile(abs));
    } catch (e) {
      if (e instanceof VaultError) throw e;
      throw new VaultError(`media not found: ${rel}`, "NOT_FOUND");
    }
  }

  private async trashPath(rel: string, isDir: boolean): Promise<string> {
    const abs = this.abs(rel);
    await assertRealContainment(this.root, abs);
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

// Every real file under a directory, recursively, notes and non-markdown
// attachments alike (unlike walk(), this does NOT skip .media: deleteFolder
// needs the concrete path of every tracked file being removed, not just
// the subset that shows up as a "note" in the tree). Still skips
// SKIP_DIRS, there's nothing of the vault's own to report there.
async function collectAllFiles(absDir: string, relPrefix: string, out: string[]): Promise<void> {
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      await collectAllFiles(join(absDir, ent.name), `${relPrefix}/${ent.name}`, out);
    } else if (ent.isFile()) {
      out.push(`${relPrefix}/${ent.name}`);
    }
  }
}

// Same shape as walk(), but rooted at an arbitrary directory (a restored
// trash subtree) rather than the vault root, and only cares about notes.
async function collectNoteFiles(absDir: string, relPrefix: string, out: string[]): Promise<void> {
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name === MEDIA_DIR) continue;
      await collectNoteFiles(join(absDir, ent.name), `${relPrefix}/${ent.name}`, out);
    } else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) {
      out.push(`${relPrefix}/${ent.name}`);
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

// `${abs}.tmp-${pid}-${Date.now()}` collided whenever two writes to the same
// destination landed in the same millisecond: both opened the same tmp
// path, so one write's content could be clobbered by the other's, and the
// renamer that lost the race got ENOENT. A random suffix plus exclusive
// ("wx") creation makes each write's tmp file unique and guarantees nobody
// else can be holding it.
function tmpNameFor(abs: string): string {
  return `${abs}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
}

async function atomicWrite(abs: string, content: string): Promise<void> {
  const tmp = tmpNameFor(abs);
  const handle = await fsOpen(tmp, "wx");
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

async function atomicWriteBytes(abs: string, bytes: Uint8Array): Promise<void> {
  const tmp = tmpNameFor(abs);
  const handle = await fsOpen(tmp, "wx");
  try {
    await handle.writeFile(bytes);
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, abs);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
}

async function safeReadFile(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch {
    return null;
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
