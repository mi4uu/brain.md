import type { Vault } from "../vault/vault";
import type { VaultIndex } from "./index";
import { basenameNoExt } from "../vault/paths";

const WIKILINK_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;

export interface RenameResult {
  patchedFiles: string[];
  totalReplacements: number;
}

function stripMdExt(path: string): string {
  return path.toLowerCase().endsWith(".md") ? path.slice(0, path.length - 3) : path;
}

export async function renameAndPatch(
  vault: Vault,
  index: VaultIndex,
  fromPath: string,
  toPath: string,
): Promise<RenameResult> {
  const oldName = basenameNoExt(fromPath);
  const newName = basenameNoExt(toPath);
  const oldLower = oldName.toLowerCase();
  const oldPathNoExtLower = stripMdExt(fromPath).toLowerCase();
  const newPathNoExt = stripMdExt(toPath);

  // Bare `[[Name]]` links are only safe to repoint when this note is the
  // sole note with that basename, otherwise we can't tell which note the
  // link author meant, and a basename collision would make us rewrite a
  // link that was never pointing at the moved note. Captured before the
  // move touches the index.
  const bareUnambiguous = index.resolveByBasename(oldName).length <= 1;

  await vault.renameNote(fromPath, toPath);
  index.rename(fromPath, toPath);

  const patchedFiles: string[] = [];
  let totalReplacements = 0;

  // A genuine no-op (same path) has nothing to patch. Previously this
  // checked only the basename, so moving `work/A.md` → `archive/A.md`
  // (basename unchanged) returned early and left path-qualified links like
  // `[[work/A]]` broken.
  if (oldPathNoExtLower === newPathNoExt.toLowerCase()) {
    return { patchedFiles, totalReplacements };
  }

  const allNotes = await vault.listAllNotes();
  await Promise.all(
    allNotes.map(async (path) => {
      let replacements = 0;
      const result = await vault.mutateNote(path, (current) => {
        if (current === null) return null;
        const patched = current.replace(WIKILINK_RE, (full, bang, inner: string) => {
          const pipe = inner.indexOf("|");
          const target = pipe >= 0 ? inner.slice(0, pipe) : inner;
          const suffix = pipe >= 0 ? inner.slice(pipe) : "";
          const trimmed = target.trim();
          const hashIdx = trimmed.indexOf("#");
          const caretIdx = trimmed.indexOf("^");
          let sliceEnd = trimmed.length;
          if (hashIdx >= 0) sliceEnd = Math.min(sliceEnd, hashIdx);
          if (caretIdx >= 0) sliceEnd = Math.min(sliceEnd, caretIdx);
          const baseName = trimmed.slice(0, sliceEnd);
          const tail = trimmed.slice(sliceEnd);
          if (baseName === "") return full;
          const baseNameLower = baseName.toLowerCase();
          const isQualified = baseName.includes("/");
          // Path-qualified targets (`work/A`) resolve to the moved note by
          // its actual old path, independent of basename ambiguity.
          const matchesFull = baseNameLower === oldPathNoExtLower;
          const matchesBare = !isQualified && baseNameLower === oldLower && bareUnambiguous;
          if (!matchesFull && !matchesBare) return full;
          const replacement = matchesFull ? newPathNoExt : newName;
          const next = `${bang}[[${replacement}${tail}${suffix}]]`;
          if (next === full) return full; // e.g. bare link, basename unchanged
          replacements += 1;
          return next;
        });
        return replacements > 0 ? patched : null;
      });
      if (result) {
        patchedFiles.push(path);
        totalReplacements += replacements;
      }
    }),
  );

  return { patchedFiles, totalReplacements };
}
