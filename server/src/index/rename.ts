import type { Vault } from "../vault/vault";
import type { VaultIndex } from "./index";
import { basenameNoExt } from "../vault/paths";
import { VaultError } from "../vault/types";

const WIKILINK_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;

export interface RenameResult {
  patchedFiles: string[];
  totalReplacements: number;
}

function stripMdExt(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, path.length - 3) : path;
}

interface RenameCtx {
  oldLower: string;
  oldPathNoExtLower: string;
  newPathNoExt: string;
  newName: string;
  bareUnambiguous: boolean;
}

// Pure match-and-replace, shared between the dry-run permission scan and
// the actual mutation so both agree on exactly which files would change.
function patchLinks(content: string, ctx: RenameCtx): { next: string; count: number } {
  let count = 0;
  const next = content.replace(WIKILINK_RE, (full, bang, inner: string) => {
    const pipe = inner.indexOf("|");
    const target = pipe >= 0 ? inner.slice(0, pipe) : inner;
    const suffix = pipe >= 0 ? inner.slice(pipe) : "";
    const trimmed = target.trim();
    const hashIdx = trimmed.indexOf("#");
    const caretIdx = trimmed.indexOf("^");
    let sliceEnd = trimmed.length;
    if (hashIdx >= 0) sliceEnd = Math.min(sliceEnd, hashIdx);
    if (caretIdx >= 0) sliceEnd = Math.min(sliceEnd, caretIdx);
    const baseNameRaw = trimmed.slice(0, sliceEnd);
    const tail = trimmed.slice(sliceEnd);
    if (baseNameRaw === "") return full;
    // Obsidian accepts both `[[work/A]]` and `[[work/A.md]]`; strip a
    // trailing .md before comparing so the latter form isn't missed.
    const baseName = stripMdExt(baseNameRaw);
    const baseNameLower = baseName.toLowerCase();
    const isQualified = baseName.includes("/");
    // Path-qualified targets (`work/A`) resolve to the moved note by its
    // actual old path, independent of basename ambiguity.
    const matchesFull = baseNameLower === ctx.oldPathNoExtLower;
    const matchesBare = !isQualified && baseNameLower === ctx.oldLower && ctx.bareUnambiguous;
    if (!matchesFull && !matchesBare) return full;
    const replacement = matchesFull ? ctx.newPathNoExt : ctx.newName;
    const nextLink = `${bang}[[${replacement}${tail}${suffix}]]`;
    if (nextLink === full) return full; // e.g. bare link, basename unchanged
    count += 1;
    return nextLink;
  });
  return { next, count };
}

export async function renameAndPatch(
  vault: Vault,
  index: VaultIndex,
  fromPath: string,
  toPath: string,
  // Per-path write predicate for the calling principal. When given, the
  // rename is refused outright (no move, no patch) if it would rewrite a
  // backlink inside a note the principal cannot write, silently skipping
  // those files would let an agent see that its own rename broke links it
  // can't see or fix, a confusing half-applied state. Refusing with a
  // clear reason is simpler to reason about.
  canWrite?: (path: string) => boolean,
): Promise<RenameResult> {
  const oldName = basenameNoExt(fromPath);
  const newName = basenameNoExt(toPath);
  const ctx: RenameCtx = {
    oldLower: oldName.toLowerCase(),
    oldPathNoExtLower: stripMdExt(fromPath).toLowerCase(),
    newPathNoExt: stripMdExt(toPath),
    newName,
    // Bare `[[Name]]` links are only safe to repoint when this note is the
    // sole note with that basename, otherwise we can't tell which note the
    // link author meant, and a basename collision would make us rewrite a
    // link that was never pointing at the moved note. Captured before the
    // move touches the index.
    bareUnambiguous: index.resolveByBasename(oldName).length <= 1,
  };

  // A genuine no-op (same path modulo case) has nothing to patch.
  const noop = ctx.oldPathNoExtLower === ctx.newPathNoExt.toLowerCase();

  if (!noop && canWrite) {
    const candidates = await vault.listAllNotes();
    const blocked: string[] = [];
    await Promise.all(
      candidates.map(async (path) => {
        if (canWrite(path)) return;
        let content: string;
        try {
          content = (await vault.readNote(path)).content;
        } catch {
          return;
        }
        if (patchLinks(content, ctx).count > 0) blocked.push(path);
      }),
    );
    if (blocked.length > 0) {
      throw new VaultError(
        `rename would rewrite links in notes you cannot write: ${blocked.sort().join(", ")}`,
        "FORBIDDEN",
      );
    }
  }

  await vault.renameNote(fromPath, toPath);
  index.rename(fromPath, toPath);

  const patchedFiles: string[] = [];
  let totalReplacements = 0;
  if (noop) return { patchedFiles, totalReplacements };

  const allNotes = await vault.listAllNotes();
  await Promise.all(
    allNotes.map(async (path) => {
      let replacements = 0;
      const result = await vault.mutateNote(path, (current) => {
        if (current === null) return null;
        const r = patchLinks(current, ctx);
        replacements = r.count;
        return r.count > 0 ? r.next : null;
      });
      if (result) {
        patchedFiles.push(path);
        totalReplacements += replacements;
      }
    }),
  );

  return { patchedFiles, totalReplacements };
}
