import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { chunkNote } from "../../server/src/rag/chunker";

// Private and internal folders never leave the vault, and symlinks are not
// followed, so the export cannot pick up files from outside it.
const SKIP = new Set([".brain", ".git", "secrets"]);

const root = process.argv[2]!;
const out: string[] = [];
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (!SKIP.has(n)) walk(p);
    } else if (n.endsWith(".md")) {
      const rel = relative(root, p).split(sep).join("/");
      for (const c of chunkNote(rel, readFileSync(p, "utf8"))) out.push(JSON.stringify({ path: rel, idx: c.chunkIndex, text: c.text }));
    }
  }
};
walk(root);
writeFileSync(process.argv[3]!, out.join("\n") + "\n");
console.log(out.length, "chunks");
