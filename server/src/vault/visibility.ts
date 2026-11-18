import type { VaultIndex } from "../index/index";
import type { SettingsStore } from "../settings/settings";
import { globToRegExp } from "./glob";

// Which notes stay out of sight. Two levels:
//   hidden   - vault setting `hidden` (globs) or frontmatter `hidden: true`:
//              out of the tree (unless "show hidden"), search, graph,
//              list_notes and semantic search;
//   noSearch - frontmatter `search: false`: still in the tree, but out of
//              search, graph and semantic search.
// Agents always read and write any of them by path; this only filters
// listings and search.
export class Visibility {
  private cacheKey = "";
  private res: RegExp[] = [];

  constructor(
    private readonly settings: SettingsStore,
    private readonly index: VaultIndex,
  ) {}

  private globs(): RegExp[] {
    const globs = this.settings.get().hidden ?? [];
    const key = globs.join("\n");
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.res = globs.map(globToRegExp);
    }
    return this.res;
  }

  // A folder is hidden when a glob matches the folder itself (`_templates`
  // for `**/_*`) or everything under it (`Journal/old/**`).
  isFolderHidden(folder: string): boolean {
    if (!folder) return false;
    const res = this.globs();
    const parts = folder.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const f = parts.slice(0, i).join("/");
      if (res.some((r) => r.test(f) || r.test(`${f}/`))) return true;
    }
    return false;
  }

  isHidden(path: string): boolean {
    if (this.index.get(path)?.hidden) return true;
    if (this.globs().some((r) => r.test(path))) return true;
    const slash = path.lastIndexOf("/");
    return slash > 0 && this.isFolderHidden(path.slice(0, slash));
  }

  // Out of keyword search, graph and semantic search.
  isSearchExcluded(path: string): boolean {
    return this.isHidden(path) || !!this.index.get(path)?.noSearch;
  }
}
