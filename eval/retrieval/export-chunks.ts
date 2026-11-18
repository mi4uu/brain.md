import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { chunkNote } from "../../server/src/rag/chunker";
const root = process.argv[2]!;
const out: string[] = [];
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".md")) {
      const rel = relative(root, p);
      for (const c of chunkNote(rel, readFileSync(p, "utf8"))) out.push(JSON.stringify({ path: rel, idx: c.chunkIndex, text: c.text }));
    }
  }
};
walk(root);
writeFileSync(process.argv[3]!, out.join("\n") + "\n");
console.log(out.length, "chunks");
