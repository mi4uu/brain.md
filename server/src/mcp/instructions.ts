import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Vault } from "../vault/vault";

// V68: server-level MCP instructions.
//
// The MCP `initialize` response carries an `instructions` string that
// clients surface to the model as standing guidance for the whole server
// (analogous to a system prompt scoped to these tools). brain.md ships a
// sensible default and lets the vault owner override it per-vault.
//
// Override file: <VAULT>/.brain/mcp-prompt.md
//   - Owner-editable, travels with the vault, git-tracked alongside notes.
//   - On first run we seed it with the default below so there is always a
//     real file to edit. Delete the file to fall back to the default.
//   - An empty (whitespace-only) file is treated as "no instructions".
//
// The default is embedded as a constant (not read from disk) because the
// server is distributed as a single `bun build --compile` binary — there is
// no repo-root file at runtime. The repo-root `mcp-prompt.md` is a
// human-readable mirror of this constant; keep the two in sync.

export const INSTRUCTIONS_REL = ".brain/mcp-prompt.md";

export const DEFAULT_MCP_INSTRUCTIONS = `# brain.md — operating instructions for agents

You are connected to a **brain.md** vault: a local-first Markdown knowledge
base that is the owner's second brain. These rules apply to every task you
do through this server. Follow them unless the user explicitly overrides them.

## 1. brain.md is the single source of truth

- Treat the vault as the authoritative, **always-current** record of what the
  owner knows, decides, and is working on. When the vault and your own memory
  disagree, the vault wins.
- Before answering anything that could live in the vault, **look it up**:
  use \`search_notes\` (full-text), \`similar_notes\` / \`context_for_query\`
  (semantic), \`read_note\`, \`list_notes\`, or \`get_backlinks\`. Do not answer
  from assumption when a tool can give you the real content.
- The search/RAG tools (\`search_notes\`, \`similar_notes\`, \`context_for_query\`,
  \`find_related\`, \`find_similar_tasks\`, \`find_orphans\`, \`weekly_digest\`) take
  an optional \`scope\` — one folder path or an array of them — to confine results
  to those folders and their subfolders. Use it when the owner asks about a
  specific area (e.g. \`scope: "work"\`) instead of searching the whole vault.
- When you learn something durable — a decision, a fact, a status change, a new
  task — **write it back** with \`write_note\` or \`append_note\` so the vault
  stays the source of truth. Knowledge that only lives in the chat is lost.
- Prefer updating an existing note over creating a near-duplicate. Search first.

## 2. Never guess the date or time — use the tool

- **Do not** infer, estimate, or invent the current date, time, day of week,
  or timezone. Your training cutoff and any date in the system prompt may be
  stale or wrong.
- Whenever a task depends on "now" — journaling, due dates, "today", "this
  week", recency, timestamps, scheduling — call \`current_datetime\` first and
  use its result verbatim. It returns the server's real ISO time, unix time,
  and timezone.
- The same applies to relative reasoning ("how long ago", "is this overdue"):
  anchor it to \`current_datetime\`, not to a guess.

## 3. Vault layout: private vs work

The vault is organised under two top-level folders. Keep things filed in the
right place as you go, rather than dumping everything at the root:

- **\`private/\`** — personal notes, journal, ideas, anything not job-related.
- **\`work/\`** — job, projects, clients, meetings, work tasks.

When creating a note, choose \`private/...\` or \`work/...\` based on its subject.
If you genuinely can't tell, ask the owner rather than guessing the folder.

## 4. Respect permissions and stay tidy

- Folders can be read-only or write-blocked for MCP. If a write is denied, do
  not retry blindly — tell the owner the folder is protected.
- Use clear, kebab-case note paths and link related notes with \`[[wikilinks]]\`
  so the graph stays connected (check \`get_backlinks\` / \`find_related\`).
- Keep edits small and intentional. Don't rewrite a whole note to change one
  line — \`append_note\` or a targeted \`write_note\` is usually right.
`;

/**
 * Load the active MCP instructions for a vault.
 *
 * Order of precedence:
 *   1. Owner override at <VAULT>/.brain/mcp-prompt.md (if non-empty).
 *   2. The embedded default (and lazily seed the override file with it so the
 *      owner has something to edit).
 *
 * Always best-effort: any FS error falls back to the embedded default so the
 * MCP server never fails to start over a missing/locked config file.
 */
export async function loadMcpInstructions(vault: Vault): Promise<string> {
  const abs = vault.abs(INSTRUCTIONS_REL);
  try {
    const raw = await readFile(abs, "utf8");
    if (raw.trim() !== "") return raw;
    // File exists but is intentionally blank → owner opted out of instructions.
    return "";
  } catch {
    // No override yet: seed one so the owner has a real file to edit, then
    // return the default. Seeding is best-effort — failures are non-fatal.
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, DEFAULT_MCP_INSTRUCTIONS, "utf8");
    } catch {
      // ignore: read-only FS, race, etc. The default is still returned below.
    }
    return DEFAULT_MCP_INSTRUCTIONS;
  }
}
