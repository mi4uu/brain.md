# example/vault — the demo vault

The vault that produced every screenshot in the project [README](../README.md).
Covers every brain.md feature in a self-explanatory tour:

```
Welcome.md
Features/
  Wikilinks.md
  Embeds & Transclusion.md
  Callouts.md
  Math.md
  Mermaid Diagrams.md
  Code Highlighting.md
  Tasks & Tables.md
  Frontmatter & Aliases.md
AI for Agents/
  RAG (Semantic Search).md
  MCP Server.md
  Folder Permissions.md
Projects/
  brain.md launch.md
  Q3 roadmap.md
Daily/
  2026-05-27.md
  2026-05-26.md
```

## Try it

Point brain.md at this folder instead of the default vault:

```sh
# from the repo root
bun run dev:server -- --vault-dir "$PWD/example/vault"
bun run dev:web        # in another shell
```

Or copy it somewhere else first if you'd rather not edit the in-repo
copy:

```sh
cp -r example/vault ~/my-brain-vault
bun run dev:server -- --vault-dir ~/my-brain-vault
```

> Start at [`Welcome.md`](vault/Welcome.md) — it lists the five-minute
> tour in the order the notes were designed to be read.

The vault ships its own `.gitignore` so brain.md's per-vault state
(`.brain/`, OS junk) won't be tracked if you `git init` your own copy.
