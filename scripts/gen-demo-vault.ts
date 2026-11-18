#!/usr/bin/env bun
// Generates a synthetic vault for graph and search load tests:
//   bun scripts/gen-demo-vault.ts <dir> [notes=3000]
// Deterministic (seeded). About 45% of notes have no links, which is close
// to real personal vaults; the rest link with a preferential-attachment
// bias, so a few hub notes collect most links.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: bun scripts/gen-demo-vault.ts <dir> [notes=3000]");
  process.exit(1);
}
const total = Number(process.argv[3] ?? 3000);

let seed = 7;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};
const pick = <T>(items: T[], weights: number[]): T => {
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
};

const folders = ["work", "journal", "people", "projects", "ideas", "reading", "archive", "inbox"];
const folderWeights = [30, 25, 8, 10, 8, 7, 7, 5];
const notes = Array.from({ length: total }, (_, i) => {
  const folder = pick(folders, folderWeights);
  return { folder, name: `${folder}-note-${String(i).padStart(4, "0")}` };
});
const degree = notes.map(() => 1);
const ids = notes.map((_, i) => i);

for (const [i, note] of notes.entries()) {
  const links: string[] = [];
  if (rand() > 0.45) {
    const k = pick([1, 2, 3, 4, 6], [2, 2, 1, 1, 1]);
    for (let n = 0; n < k; n++) {
      const j = pick(ids, degree);
      if (j === i) continue;
      links.push(notes[j]!.name);
      degree[j]! += 1;
    }
  }
  mkdirSync(join(dir, note.folder), { recursive: true });
  writeFileSync(
    join(dir, note.folder, `${note.name}.md`),
    `# ${note.name}\n\nGenerated test note.\n\n${links.map((l) => `[[${l}]]`).join(" ")}\n`,
  );
}
console.log(`[gen-demo-vault] ${total} notes in ${dir}`);
