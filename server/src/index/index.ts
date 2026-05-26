import { mkdir, readFile, writeFile, rename, unlink, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Vault } from "../vault/vault";
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

  constructor(private readonly vault: Vault) {}

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

  byTag(tag: string): string[] {
    const t = tag.toLowerCase();
    return this.entries()
      .filter((e) => e.tags.includes(t))
      .map((e) => e.path)
      .sort();
  }

  allTags(): Array<{ tag: string; count: number }> {
    const counts = new Map<string, number>();
    for (const e of this.entries()) {
      for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  backlinks(toPath: string): Array<{ from: string; lineNo: number; context: string; embed: boolean }> {
    const target = basenameNoExt(toPath).toLowerCase();
    const out: Array<{ from: string; lineNo: number; context: string; embed: boolean }> = [];
    for (const e of this.entries()) {
      if (e.path === toPath) continue;
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
    if (ok) return;
    await this.buildAll();
    await this.persist();
  }
}

function stripMd(name: string): string {
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}
