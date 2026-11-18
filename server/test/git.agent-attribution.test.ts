import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiKeyIdentity, externalIdentity, withSubAgent } from "../src/auth/identity";
import { singleActorCommitOpts } from "../src/git/autocommit";
import { GitRepo } from "../src/git/git";

let dir: string;
let repo: GitRepo;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-agent-attr-"));
  repo = new GitRepo(dir);
  await repo.ensure();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("per-agent attribution", () => {
  test("X-Brainmd-Agent names the agent behind a shared key, sanitised", () => {
    const key = apiKeyIdentity("local", "openclaw", "k1");
    const a = withSubAgent(key, "sekretarz");
    expect(a.name).toBe("openclaw/sekretarz");
    expect(a.credentialId).toBe("apikey:k1/sekretarz");
    expect(withSubAgent(key, "lowca\nAgent: evil").name).toBe("openclaw/lowcaAgent evil");
    expect(withSubAgent(key, "  ")).toBe(key);
  });

  test("a person's identity ignores the header", () => {
    const me = externalIdentity("google:1", "Michał", "m@example.com");
    expect(withSubAgent(me, "sekretarz")).toBe(me);
  });

  test("history shows author, email and agent for each version", async () => {
    await writeFile(join(dir, "a.md"), "one");
    await repo.commitAll("by agent", singleActorCommitOpts(withSubAgent(apiKeyIdentity("local", "openclaw", "k1"), "sekretarz")));
    await writeFile(join(dir, "a.md"), "two");
    await repo.commitAll("by me", singleActorCommitOpts(externalIdentity("google:1", "Michał", "m@example.com")));
    const log = await repo.log({ path: "a.md" });
    expect(log.map((c) => [c.author, c.authorEmail, c.agent])).toEqual([
      ["Michał", "m@example.com", ""],
      ["openclaw/sekretarz", "agent@brain.local", "openclaw/sekretarz"],
    ]);
  });
});
