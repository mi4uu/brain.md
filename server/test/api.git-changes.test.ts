import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { parseChanges } from "../src/git/git";

let h: AppHandle;
let dir: string;
let owner: string;
let agentKey: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-git-changes-"));
  h = createApp({ vaultDir: dir, gitAutocommit: true, gitDebounceMs: 60_000 });
  await h.repo.ensure();
  await call("POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
  owner = ((await (await call("POST", "/api/auth/login", { password: "hunter2hunter2" })).json()) as { token: string }).token;
  agentKey = ((await (await call("POST", "/api/auth/keys", { name: "claude-code" }, owner)).json()) as { token: string }).token;
});

afterEach(async () => {
  h.autocommit.dispose();
  await rm(dir, { recursive: true, force: true });
});

function call(method: string, path: string, body?: unknown, bearer?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return h.app.handle(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  ) as Promise<Response>;
}

async function write(path: string, content: string, bearer: string) {
  const r = await call("PUT", `/api/note/${path.split("/").map(encodeURIComponent).join("/")}`, { content }, bearer);
  expect(r.status).toBeLessThan(300);
  await h.autocommit.flush();
}

interface Changes {
  enabled: boolean;
  seen: { sha: string; ts: number } | null;
  commits: Array<{ sha: string; ts: number; files: Array<{ path: string; status: string; actor: string; actorKind: string; oldPath?: string }> }>;
  hasMore: boolean;
}

async function changes(bearer = owner, query = ""): Promise<Changes> {
  const r = await call("GET", `/api/git/changes${query}`, undefined, bearer);
  expect(r.status).toBe(200);
  return (await r.json()) as Changes;
}

describe("GET /api/git/changes", () => {
  test("lists files per commit with actor and kind, paths with spaces and Polish letters intact", async () => {
    await write("Dział A/zażółć ok.md", "one", owner);
    await write("Dział A/zażółć ok.md", "one\ntwo", agentKey);
    const c = await changes();
    expect(c.enabled).toBe(true);
    const [latest, first] = c.commits;
    expect(latest!.files).toEqual([
      { path: "Dział A/zażółć ok.md", status: "modified", actor: "claude-code", actorKind: "agent" },
    ]);
    expect(first!.files[0]!.status).toBe("added");
    expect(first!.files[0]!.actorKind).toBe("human");
  });

  test("never lists .brain/ or .gitignore", async () => {
    await write("a.md", "x", owner);
    const c = await changes();
    const paths = c.commits.flatMap((x) => x.files.map((f) => f.path));
    expect(paths.some((p) => p.startsWith(".brain/") || p === ".gitignore")).toBe(false);
  });

  test("agent credentials cannot list the vault-wide feed or move the cursor", async () => {
    expect((await call("GET", "/api/git/changes", undefined, agentKey)).status).toBe(403);
    expect((await call("POST", "/api/git/changes/seen", { sha: "abcdef1", ts: 1 }, agentKey)).status).toBe(403);
  });

  test("paging with before= and limit", async () => {
    for (let i = 0; i < 5; i++) await write("p.md", `v${i}`, agentKey);
    const page1 = await changes(owner, "?limit=2");
    expect(page1.commits.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    const page2 = await changes(owner, `?limit=2&before=${page1.commits[1]!.sha}`);
    expect(page2.commits[0]!.sha).not.toBe(page1.commits[1]!.sha);
    expect(page2.commits[0]!.ts).toBeLessThanOrEqual(page1.commits[1]!.ts);
  });
});

describe("POST /api/git/changes/seen", () => {
  test("stores the cursor untracked and never moves it backwards", async () => {
    await write("a.md", "x", agentKey);
    const sha = (await changes()).commits[0]!.sha;
    await call("POST", "/api/git/changes/seen", { sha, ts: 2000 }, owner);
    await call("POST", "/api/git/changes/seen", { sha, ts: 1000 }, owner);
    expect((await changes()).seen).toEqual({ sha, ts: 2000 });
    const stored = JSON.parse(await readFile(join(dir, ".brain", "changes-seen.json"), "utf8"));
    expect(stored.ts).toBe(2000);
    const status = Bun.spawnSync(["git", "-C", dir, "status", "--porcelain"]).stdout.toString();
    expect(status).not.toContain("changes-seen");
  });
});

describe("POST /api/git/revert", () => {
  test("patch mode undoes one change and keeps later edits", async () => {
    await write("n.md", "a\nb\nc\nd\ne\nf\n", owner);
    await write("n.md", "a\nB-agent\nc\nd\ne\nf\n", agentKey);
    const agentSha = (await changes()).commits[0]!.sha;
    await write("n.md", "a\nB-agent\nc\nd\ne\nF-human\n", owner);
    const r = await call("POST", "/api/git/revert", { sha: agentSha, path: "n.md", mode: "patch" }, owner);
    expect(r.status).toBe(200);
    expect(await readFile(join(dir, "n.md"), "utf8")).toBe("a\nb\nc\nd\ne\nF-human\n");
  });

  test("patch mode undoes an append even when a later append sits right after it", async () => {
    const body = "# Note\n\nfirst\nsecond\nthird\n";
    await write("n.md", body, owner);
    await write("n.md", `${body}agent added\n`, agentKey);
    const agentSha = (await changes()).commits[0]!.sha;
    await write("n.md", `${body}agent added\nhuman added\n`, owner);
    const r = await call("POST", "/api/git/revert", { sha: agentSha, path: "n.md", mode: "patch" }, owner);
    expect(r.status).toBe(200);
    expect(await readFile(join(dir, "n.md"), "utf8")).toBe(`${body}human added\n`);
  });

  test("patch mode reports a conflict when later edits overlap", async () => {
    await write("n.md", "line\n", owner);
    await write("n.md", "agent line\n", agentKey);
    const agentSha = (await changes()).commits[0]!.sha;
    await write("n.md", "human rewrote it\n", owner);
    const r = await call("POST", "/api/git/revert", { sha: agentSha, path: "n.md", mode: "patch" }, owner);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("PATCH_CONFLICT");
    expect(await readFile(join(dir, "n.md"), "utf8")).toBe("human rewrote it\n");
  });

  test("restore mode puts the note back to before the change, later edits included", async () => {
    await write("n.md", "original\n", owner);
    await write("n.md", "agent\n", agentKey);
    const agentSha = (await changes()).commits[0]!.sha;
    await write("n.md", "agent then human\n", owner);
    const r = await call("POST", "/api/git/revert", { sha: agentSha, path: "n.md", mode: "restore" }, owner);
    expect(r.status).toBe(200);
    expect(await readFile(join(dir, "n.md"), "utf8")).toBe("original\n");
    const latest = (await changes()).commits[0]!;
    expect(latest.files[0]!.actorKind).toBe("human");
  });

  test("restore mode refuses a note the change created", async () => {
    await write("new.md", "hi\n", agentKey);
    const sha = (await changes()).commits[0]!.sha;
    const r = await call("POST", "/api/git/revert", { sha, path: "new.md", mode: "restore" }, owner);
    expect(r.status).toBe(404);
    expect(await readFile(join(dir, "new.md"), "utf8")).toBe("hi\n");
  });

  test("agent credentials cannot revert", async () => {
    await write("n.md", "x\n", owner);
    const sha = (await changes()).commits[0]!.sha;
    expect((await call("POST", "/api/git/revert", { sha, path: "n.md", mode: "restore" }, agentKey)).status).toBe(403);
  });
});

describe("parseChanges", () => {
  test("renames, mixed-actor trailers and unattributed disk edits", () => {
    const out =
      "\x02aaa1111\x1f100\x1fbrain.md owner\x1fowner@brain.local\x1f\x1fc.md claude-code\x1eDział A/x y.md brain.md owner\x1eloose.md brain.md\n" +
      "R100\0b.md\0c.md\0M\0Dział A/x y.md\0M\0loose.md\0\0" +
      "\x02bbb2222\x1f90\x1fbrain.md\x1fbrain@local\x1f\x1f\nM\0z.md\0";
    const [mixed, disk] = parseChanges(out);
    expect(mixed!.files).toEqual([
      { path: "c.md", oldPath: "b.md", status: "renamed", actor: "claude-code", actorKind: "agent" },
      { path: "Dział A/x y.md", status: "modified", actor: "brain.md owner", actorKind: "human" },
      { path: "loose.md", status: "modified", actor: "brain.md", actorKind: "unattributed" },
    ]);
    expect(disk!.files[0]!.actorKind).toBe("unattributed");
  });
});
