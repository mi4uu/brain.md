import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Vault, MutationEvent } from "../vault/vault";
import { basenameNoExt } from "../vault/paths";
import { parseNote } from "./parse";

export interface IndexEntry {
  path: string;
  mtime: number;
  size: number;
  basename: string;
  basenameLower: string;
  title: string;
  tags: string[];
  aliases: string[];
  outLinks: Array<{
    target: string;
    targetLower: string;
    alias: string | null;
    embed: boolean;
    lineNo: number;
    context: string;
  }>;
  headings: Array<{ level: number; text: string; line: number }>;
  body: string;
}

export interface IndexData {
  version: 1;
  entries: Record<string, IndexEntry>;
}

const INDEX_REL = ".brain/index.json";

export class VaultIndex {
  private data: IndexData = { version: 1, entries: {} };
  private unsubscribe?: () => void;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly vault: Vault) {}

  // Centralises index maintenance on the same vault.onMutation feed RAG
  // already uses, so every mutation path (REST, MCP write_note/append_note,
  // trash restore, git restore via vault.notifyWrite) updates the index in
  // one place instead of each caller remembering to.
  start(): void {
    if (this.unsubscribe) return;
    // Returning the promise (not firing it with `void`) lets Vault.notify()
    // await it, so a write's HTTP/MCP response only lands once the index
    // actually reflects it — RagPipeline.start() deliberately doesn't do
    // this, so slow embedding never blocks a note write.
    this.unsubscribe = this.vault.onMutation((e) => this.handleEvent(e));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private async handleEvent(e: MutationEvent): Promise<void> {
    try {
      switch (e.kind) {
        case "write":
          if (e.path.endsWith(".md")) await this.updatePath(e.path);
          break;
        case "delete":
          if (e.path.endsWith(".md")) {
            this.remove(e.path);
            this.schedulePersist();
          }
          break;
        case "rename":
          if (e.path.endsWith(".md")) {
            this.rename(e.extra ?? e.path, e.path);
            this.schedulePersist();
          }
          break;
        case "folder-delete":
          for (const p of e.paths ?? []) this.remove(p);
          this.schedulePersist();
          break;
        default:
          return;
      }
    } catch (err) {
      console.warn(
        `[index] ${e.kind} ${e.path} failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, 1500);
  }

  snapshot(): IndexData {
    return this.data;
  }

  entries(): IndexEntry[] {
    return Object.values(this.data.entries);
  }

  get(path: string): IndexEntry | undefined {
    return this.data.entries[path];
  }

  resolveByBasename(name: string): string[] {
    const target = stripMd(name).toLowerCase();
    const hits: string[] = [];
    for (const e of this.entries()) {
      if (e.basenameLower === target) hits.push(e.path);
    }
    return hits;
  }

  resolveByPath(target: string): string | null {
    const normalized = stripMd(target).replace(/^\/+/, "");
    const withMd = `${normalized}.md`;
    for (const e of this.entries()) {
      if (e.path === withMd) return e.path;
      if (e.path.toLowerCase() === withMd.toLowerCase()) return e.path;
    }
    return null;
  }

  resolveByAlias(name: string): string[] {
    const target = stripMd(name).toLowerCase();
    const hits: string[] = [];
    for (const e of this.entries()) {
      for (const a of e.aliases) {
        if (a.toLowerCase() === target) {
          hits.push(e.path);
          break;
        }
      }
    }
    return hits;
  }

  /** path-aware → basename → aliases */
  resolveAny(target: string): { matches: string[]; source: "path" | "basename" | "alias" | null } {
    const byPath = this.resolveByPath(target);
    if (byPath) return { matches: [byPath], source: "path" };
    const byBase = this.resolveByBasename(target);
    if (byBase.length > 0) return { matches: byBase, source: "basename" };
    const byAlias = this.resolveByAlias(target);
    if (byAlias.length > 0) return { matches: byAlias, source: "alias" };
    return { matches: [], source: null };
  }

  /** alias → list of paths */
  aliasMap(): Record<string, string[]> {
    const m: Record<string, string[]> = {};
    for (const e of this.entries()) {
      for (const a of e.aliases) {
        const key = a.toLowerCase();
        (m[key] ??= []).push(e.path);
      }
    }
    return m;
  }

  byTag(tag: string, allowed?: (path: string) => boolean): string[] {
    const t = tag.toLowerCase();
    return this.entries()
      .filter((e) => e.tags.includes(t))
      .filter((e) => !allowed || allowed(e.path))
      .map((e) => e.path)
      .sort();
  }

  // `allowed`: per-folder read permission gate. Entries failing it don't
  // contribute to tag counts / backlink results at all.
  allTags(allowed?: (path: string) => boolean): Array<{ tag: string; count: number }> {
    const counts = new Map<string, number>();
    for (const e of this.entries()) {
      if (allowed && !allowed(e.path)) continue;
      for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  backlinks(
    toPath: string,
    allowed?: (path: string) => boolean,
  ): Array<{ from: string; lineNo: number; context: string; embed: boolean }> {
    const target = basenameNoExt(toPath).toLowerCase();
    const out: Array<{ from: string; lineNo: number; context: string; embed: boolean }> = [];
    for (const e of this.entries()) {
      if (e.path === toPath) continue;
      // The backlink's source note is itself content — don't leak its
      // path or quoted context if the caller can't read that note.
      if (allowed && !allowed(e.path)) continue;
      for (const l of e.outLinks) {
        if (l.targetLower === target) {
          out.push({ from: e.path, lineNo: l.lineNo, context: l.context, embed: l.embed });
        }
      }
    }
    return out;
  }

  async buildAll(): Promise<void> {
    const notes = await this.vault.listAllNotes();
    const next: Record<string, IndexEntry> = {};
    await Promise.all(
      notes.map(async (p) => {
        const e = await this.buildEntry(p);
        if (e) next[p] = e;
      }),
    );
    this.data = { version: 1, entries: next };
  }

  async updatePath(path: string): Promise<void> {
    const e = await this.buildEntry(path);
    if (e) this.data.entries[path] = e;
    else delete this.data.entries[path];
    this.schedulePersist();
  }

  remove(path: string): void {
    delete this.data.entries[path];
  }

  rename(from: string, to: string): void {
    const e = this.data.entries[from];
    if (!e) return;
    delete this.data.entries[from];
    this.data.entries[to] = { ...e, path: to, basename: basenameNoExt(to), basenameLower: basenameNoExt(to).toLowerCase() };
  }

  // V-concurrency: the initial build is persisted but nothing after it was,
  // so a restart kept trusting a snapshot that could be arbitrarily stale.
  // Reconciles the loaded snapshot against what's actually on disk: entries
  // for notes that no longer exist are dropped, entries for notes whose
  // mtime moved (edited while the server was down, or never indexed) are
  // rebuilt.
  async reconcile(): Promise<void> {
    const notes = await this.vault.listAllNotes();
    const onDisk = new Set(notes);
    for (const path of Object.keys(this.data.entries)) {
      if (!onDisk.has(path)) delete this.data.entries[path];
    }
    await Promise.all(
      notes.map(async (path) => {
        const existing = this.data.entries[path];
        if (existing) {
          const s = await this.vault.stat(path);
          if (s.exists && s.mtime === existing.mtime) return;
        }
        const e = await this.buildEntry(path);
        if (e) this.data.entries[path] = e;
      }),
    );
  }

  private async buildEntry(path: string): Promise<IndexEntry | null> {
    try {
      const data = await this.vault.readNote(path);
      const parsed = parseNote(data.content);
      const bn = basenameNoExt(path);
      return {
        path,
        mtime: data.mtime,
        size: data.content.length,
        basename: bn,
        basenameLower: bn.toLowerCase(),
        title: parsed.title || bn,
        tags: parsed.tags,
        aliases: parsed.aliases,
        outLinks: parsed.links.map((l) => ({
          target: l.target,
          targetLower: stripMd(l.target).toLowerCase(),
          alias: l.alias,
          embed: l.embed,
          lineNo: l.lineNo,
          context: l.context,
        })),
        headings: parsed.headings,
        body: parsed.body,
      };
    } catch {
      return null;
    }
  }

  async persist(): Promise<void> {
    const abs = this.vault.abs(INDEX_REL);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(this.data));
    try {
      await rename(tmp, abs);
    } catch (e) {
      await unlink(tmp).catch(() => {});
      throw e;
    }
  }

  async load(): Promise<boolean> {
    const abs = this.vault.abs(INDEX_REL);
    try {
      const raw = await readFile(abs, "utf8");
      const parsed = JSON.parse(raw) as IndexData;
      if (parsed.version === 1) {
        this.data = parsed;
        return true;
      }
    } catch {
      // ignore, fall through
    }
    return false;
  }

  async loadOrBuild(): Promise<void> {
    const ok = await this.load();
    if (!ok) {
      await this.buildAll();
    } else {
      await this.reconcile();
    }
    await this.persist();
  }
}

function stripMd(name: string): string {
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}
