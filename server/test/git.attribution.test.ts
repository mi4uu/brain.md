import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// board-plan Part B / P2: git commit author must reflect WHO changed a
// file (owner, a named API key, or an MCP OAuth client), not the fixed
// "brain.md" committer every commit already carries. Drives real HTTP/MCP
// requests through the app (same pattern as mcp.permissions.test.ts) so
// identity resolution in auth-middleware.ts is exercised end to end, not
// just the Autocommit grouping logic in isolation.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-git-attrib-"));
  // Large debounce: nothing auto-flushes mid-test, every flush is explicit.
  handle = createApp({ vaultDir: dir, gitAutocommit: true, gitDebounceMs: 60_000 });
  await handle.repo.ensure();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface LogEntry {
  authorName: string;
  authorEmail: string;
  body: string;
}

// Independent of GitRepo.log() (which doesn't surface email/body), reads
// the raw commits this test actually needs to assert on.
async function gitLog(): Promise<LogEntry[]> {
  const proc = Bun.spawn(
    ["git", "-C", dir, "log", "--format=%an%x1f%ae%x1f%B%x1e"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out
    .split("\x1e")
    .map((e) => e.trim())
    .filter((e) => e.length > 0)
    .map((entry) => {
      const [authorName, authorEmail, body] = entry.split("\x1f");
      return { authorName: authorName ?? "", authorEmail: authorEmail ?? "", body: body ?? "" };
    });
}

async function put(path: string, content: string, bearer?: string): Promise<void> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  await handle.app.handle(
    new Request(`http://localhost${path}`, { method: "PUT", headers, body: JSON.stringify({ content }) }),
  );
}

async function setPassword(password: string): Promise<void> {
  const r = await handle.app.handle(
    new Request("http://localhost/api/auth/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: password }),
    }),
  );
  expect(r.status).toBe(200);
}

async function login(password: string): Promise<string> {
  const r = await handle.app.handle(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }),
  );
  const j = (await r.json()) as { token: string };
  return j.token;
}

async function createApiKey(ownerToken: string, name: string): Promise<string> {
  const r = await handle.app.handle(
    new Request("http://localhost/api/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ name }),
    }),
  );
  const j = (await r.json()) as { token: string };
  return j.token;
}

function appFetch(): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    handle.app.handle(new Request(input, init))) as unknown as typeof fetch;
}

async function mcpClient(bearer?: string): Promise<Client> {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: appFetch(),
    requestInit: { headers },
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

describe("git commit author from identity", () => {
  test("password login commits as the configured owner, no trailers", async () => {
    await setPassword("hunter2hunter2");
    const token = await login("hunter2hunter2");
    await put("/api/note/owner.md", "hello", token);
    await handle.autocommit.flush();

    const log = await gitLog();
    const commit = log.find((c) => c.body.startsWith("auto:"));
    expect(commit).toBeDefined();
    expect(commit!.authorName).toBe("brain.md owner");
    expect(commit!.authorEmail).toBe("owner@brain.local");
    expect(commit!.body).not.toContain("On-Behalf-Of:");
  });

  test("unconfigured auth still commits as the local owner identity", async () => {
    await handle.vault.writeNoteChecked("open.md", "x");
    await put("/api/note/open.md", "x again");
    await handle.autocommit.flush();
    const log = await gitLog();
    const commit = log.find((c) => c.body.startsWith("auto:"));
    expect(commit!.authorName).toBe("brain.md owner");
  });

  test("API key commits as the key name, with On-Behalf-Of + Agent trailers", async () => {
    await setPassword("hunter2hunter2");
    const ownerToken = await login("hunter2hunter2");
    const keyToken = await createApiKey(ownerToken, "ci-bot");
    await put("/api/note/bot.md", "hi", keyToken);
    await handle.autocommit.flush();

    const log = await gitLog();
    const commit = log.find((c) => c.body.startsWith("auto:"));
    expect(commit!.authorName).toBe("ci-bot");
    expect(commit!.body).toContain("Agent: ci-bot");
    expect(commit!.body).toMatch(/On-Behalf-Of: apikey:[0-9a-f]+/);
  });

  test("MCP OAuth client commits under the client's name via write_note", async () => {
    await setPassword("hunter2hunter2");
    await handle.vault.writeNote("public/b.md", "existing\n");
    await handle.index.updatePath("public/b.md");
    const pair = handle.oauthStore.issueTokenPair({
      clientId: "ci-agent-client",
      scope: "vault:read vault:write",
      resource: "http://localhost/mcp",
      sub: "oauth-sub-1",
    });
    const client = await mcpClient(pair.accessToken);
    await client.callTool({ name: "write_note", arguments: { path: "public/b.md", content: "updated" } });
    await client.close();
    await handle.autocommit.flush();

    const log = await gitLog();
    const commit = log.find((c) => c.body.startsWith("auto:"));
    expect(commit!.authorName).toBe("ci-agent-client");
    expect(commit!.body).toContain("Agent: ci-agent-client");
    expect(commit!.body).toContain("On-Behalf-Of: oauth-sub-1");
  });

  // Design: several actors in one flush window land in exactly ONE
  // commit, not one per actor, see autocommit.ts's module comment. The
  // commit is attributed to the owner, with a Changed-by trailer per
  // path naming who actually touched it.
  test("several actors in one flush window → one commit, owner-attributed, with Changed-by trailers", async () => {
    await setPassword("hunter2hunter2");
    const ownerToken = await login("hunter2hunter2");
    const keyToken = await createApiKey(ownerToken, "ci-bot");

    // Both writes land before any flush, same debounce window.
    await put("/api/note/owner-file.md", "from owner", ownerToken);
    await put("/api/note/bot-file.md", "from bot", keyToken);
    await handle.autocommit.flush();

    const log = await gitLog();
    const autoCommits = log.filter((c) => c.body.startsWith("auto:"));
    expect(autoCommits.length).toBe(1);
    expect(autoCommits[0]!.authorName).toBe("brain.md owner");
    expect(autoCommits[0]!.body).toContain("Changed-by: owner-file.md brain.md owner");
    expect(autoCommits[0]!.body).toContain("Changed-by: bot-file.md ci-bot");
  });

  // Regression: app.ts's vault.onMutation listener only passed e.path
  // (the rename's target) to autocommit.notify(), never e.extra (the
  // source). The commit staged the new path but never the old one's
  // deletion, leaving it to show up unstaged (or get swept into some
  // later, differently-attributed commit) instead of landing in this
  // rename's own commit.
  test("a rename stages both the new path and the old path's deletion in one commit", async () => {
    await put("/api/note/old.md", "hello");
    await handle.autocommit.flush();

    const r = await handle.app.handle(
      new Request("http://localhost/api/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "old.md", to: "new.md" }),
      }),
    );
    expect(r.status).toBe(200);
    await handle.autocommit.flush();

    const status = Bun.spawn(["git", "-C", dir, "status", "--porcelain"], { stdout: "pipe" });
    const porcelain = (await new Response(status.stdout).text()).trim();
    await status.exited;
    expect(porcelain).toBe("");

    const show = Bun.spawn(["git", "-C", dir, "show", "--name-status", "--format=", "HEAD"], { stdout: "pipe" });
    const names = (await new Response(show.stdout).text()).trim();
    await show.exited;
    expect(names).toContain("new.md");
  });

  // Should-fix: /restore committed via repo.commitAll with no author or
  // trailers at all, unlike every other mutation path in this describe
  // block. A restore run by an API key (or any non-owner credential with
  // folder write access) must still show up as that credential, not the
  // default committer identity.
  test("restore commits under the acting credential, with On-Behalf-Of + Agent trailers", async () => {
    await setPassword("hunter2hunter2");
    const ownerToken = await login("hunter2hunter2");
    const keyToken = await createApiKey(ownerToken, "ci-bot");

    await put("/api/note/a.md", "first", ownerToken);
    await handle.autocommit.flush();
    await put("/api/note/a.md", "second", ownerToken);
    await handle.autocommit.flush();

    const logRes = await handle.app.handle(
      new Request("http://localhost/api/git/log?path=a.md", {
        headers: { authorization: `Bearer ${ownerToken}` },
      }),
    );
    const entries = (await logRes.json()) as Array<{ sha: string }>;
    const firstSha = entries[entries.length - 1]!.sha;

    const restore = await handle.app.handle(
      new Request("http://localhost/api/git/restore", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${keyToken}` },
        body: JSON.stringify({ path: "a.md", sha: firstSha }),
      }),
    );
    expect(restore.status).toBe(200);

    const log = await gitLog();
    const commit = log.find((c) => c.body.startsWith("restore "));
    expect(commit).toBeDefined();
    expect(commit!.authorName).toBe("ci-bot");
    expect(commit!.body).toContain("Agent: ci-bot");
    expect(commit!.body).toMatch(/On-Behalf-Of: apikey:[0-9a-f]+/);
  });
});
