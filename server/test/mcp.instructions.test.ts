import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../src/vault/vault";
import {
  loadMcpInstructions,
  DEFAULT_MCP_INSTRUCTIONS,
  INSTRUCTIONS_REL,
} from "../src/mcp/instructions";

let dir!: string;
let vault!: Vault;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-mcp-prompt-"));
  vault = new Vault(dir);
  await vault.ensureRoot();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadMcpInstructions — V68", () => {
  test("returns the embedded default when no override exists", async () => {
    const out = await loadMcpInstructions(vault);
    expect(out).toBe(DEFAULT_MCP_INSTRUCTIONS);
  });

  test("seeds <vault>/.brain/mcp-prompt.md on first load", async () => {
    await loadMcpInstructions(vault);
    const seeded = await readFile(vault.abs(INSTRUCTIONS_REL), "utf8");
    expect(seeded).toBe(DEFAULT_MCP_INSTRUCTIONS);
  });

  test("owner override is returned verbatim", async () => {
    const custom = "# My rules\n\nAlways call current_datetime.\n";
    await mkdir(dirname(vault.abs(INSTRUCTIONS_REL)), { recursive: true });
    await writeFile(vault.abs(INSTRUCTIONS_REL), custom, "utf8");
    const out = await loadMcpInstructions(vault);
    expect(out).toBe(custom);
  });

  test("blank override opts out of instructions", async () => {
    await mkdir(dirname(vault.abs(INSTRUCTIONS_REL)), { recursive: true });
    await writeFile(vault.abs(INSTRUCTIONS_REL), "   \n\t\n", "utf8");
    const out = await loadMcpInstructions(vault);
    expect(out).toBe("");
  });

  test("default mentions the source-of-truth and no-guessing rules", () => {
    expect(DEFAULT_MCP_INSTRUCTIONS).toContain("single source of truth");
    expect(DEFAULT_MCP_INSTRUCTIONS).toContain("current_datetime");
    expect(DEFAULT_MCP_INSTRUCTIONS).toContain("private/");
    expect(DEFAULT_MCP_INSTRUCTIONS).toContain("work/");
  });
});
