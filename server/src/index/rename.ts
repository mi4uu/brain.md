import type { Vault } from "../vault/vault";
import type { VaultIndex } from "./index";
import { basenameNoExt } from "../vault/paths";

const WIKILINK_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;

export interface RenameResult {
  patchedFiles: string[];
  totalReplacements: number;
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

  await vault.renameNote(fromPath, toPath);
  index.rename(fromPath, toPath);

  const patchedFiles: string[] = [];
  let totalReplacements = 0;

  if (oldLower === newName.toLowerCase()) {
    return { patchedFiles, totalReplacements };
  }

  const allNotes = await vault.listAllNotes();
  await Promise.all(
    allNotes.map(async (path) => {
      const data = await vault.readNote(path);
      let replacements = 0;
      const patched = data.content.replace(WIKILINK_RE, (full, bang, inner: string) => {
        const pipe = inner.indexOf("|");
        let target = pipe >= 0 ? inner.slice(0, pipe) : inner;
        const suffix = pipe >= 0 ? inner.slice(pipe) : "";
        const trimmed = target.trim();
        const hashIdx = trimmed.indexOf("#");
        const caretIdx = trimmed.indexOf("^");
        let sliceEnd = trimmed.length;
        if (hashIdx >= 0) sliceEnd = Math.min(sliceEnd, hashIdx);
        if (caretIdx >= 0) sliceEnd = Math.min(sliceEnd, caretIdx);
        const baseName = trimmed.slice(0, sliceEnd);
        const tail = trimmed.slice(sliceEnd);
        if (baseName.toLowerCase() !== oldLower) return full;
        if (baseName === "") return full;
        replacements += 1;
        return `${bang}[[${newName}${tail}${suffix}]]`;
      });
      if (replacements > 0) {
        await vault.writeNote(path, patched);
        await index.updatePath(path);
        patchedFiles.push(path);
        totalReplacements += replacements;
      }
    }),
  );

  return { patchedFiles, totalReplacements };
}
