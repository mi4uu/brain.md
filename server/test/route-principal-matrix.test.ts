import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Route x principal matrix (Codex r3 systematic pass A). Every HTTP route
// gets run against five principals and must land on the outcome its class
// says it should, not whatever the route happened to implement. A route
// that fails this matrix is a bug to fix, not a reason to narrow the test.
//
// Principals:
//   owner        password-login session, full access everywhere
//   open         auth.json never configured, back-compat full access
//   apikey       named API key, "secret/" folder denied read+write
//   oauth-read   OAuth access token, scope vault:read only
//   oauth-write  OAuth access token, scope vault:write only
//
// REST (/api/*) never accepts an OAuth bearer at all (auth-middleware.ts
// restricts OAuth to /mcp); both OAuth principals land on 401 for every
// REST row below, by design, regardless of class. MCP transport rows
// (bottom section) are where OAuth scope actually gets exercised.
//
// Classes:
//   admin     administers the server itself (settings, keys, folder-perm
//             map, git commit/flush/checkpoint/status, anything that
//             makes the server fetch a caller-supplied URL): owner/open
//             only, apikey forbidden regardless of folder.
//   strict    a single note/path operation under folder perms: owner/open
//             succeed, apikey is forbidden because the target path
//             ("secret/a.md" or the "secret" folder) is denied.
//   filtered  a list/search-style route: never forbidden, but the denied
//             path must be absent from an apikey's results while present
//             for owner/open.
//   public    no folder scoping applies at all (benign, vault-wide, or
//             served before auth even runs): every REST principal gets
//             through, including apikey.

type PrincipalKind = "owner" | "open" | "apikey-denied" | "oauth-read" | "oauth-write";
const PRINCIPALS: PrincipalKind[] = ["owner", "open", "apikey-denied", "oauth-read", "oauth-write"];

interface Fixture {
  handle: AppHandle;
  dir: string;
  bearer?: string;
}

const openDirs: string[] = [];
const openHandles: AppHandle[] = [];
afterEach(async () => {
  // See autocommit.ts's module comment: an undisposed instance can hold a
  // live retry timer that must not outlive its fixture's temp directory.
  for (const h of openHandles.splice(0)) h.autocommit.dispose();
  await Promise.all(openDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function call(
  handle: AppHandle,
  method: string,
  path: string,
  body?: unknown,
  bearer?: string,
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const r = await handle.app.handle(new Request(`http://localhost${path}`, init));
  const text = await r.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text; // non-JSON body (media bytes, the SPA's HTML, …)
  }
  return { status: r.status, json };
}

async function makeFixture(kind: PrincipalKind): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), `brain-matrix-${kind}-`));
  openDirs.push(dir);
  const handle = createApp({ vaultDir: dir, gitAutocommit: true, gitDebounceMs: 20 });
  openHandles.push(handle);
  await handle.repo.ensure();

  await handle.vault.writeNote("secret/a.md", "top secret body\n- [ ] secret task\n#secrettag\n");
  await handle.vault.writeNote("public/b.md", "public body\n- [ ] public task\n");
  await handle.vault.writeMedia("secret/a.md", "pic.png", new Uint8Array([1, 2, 3]));
  await handle.index.updatePath("secret/a.md");
  await handle.index.updatePath("public/b.md");
  await handle.autocommit.flush();

  // Seed a cosmetic folder-meta entry on "secret" so the "filtered"
  // folder-meta row has something to hide. Works unauthenticated too:
  // with no password set yet, every principal is "open" regardless of
  // bearer, so this always succeeds before the per-kind setup below.
  await call(handle, "POST", "/api/folder-meta", { path: "secret", icon: "lock" });

  if (kind === "open") return { handle, dir, bearer: undefined };

  await call(handle, "POST", "/api/auth/set", { newPassword: "hunter2hunter2" });
  await handle.authStore.load();
  const login = await call(handle, "POST", "/api/auth/login", { password: "hunter2hunter2" });
  const ownerToken = (login.json as { token: string }).token;

  await call(handle, "POST", "/api/folder-mcp-perms", { path: "secret", read: false, write: false }, ownerToken);

  if (kind === "owner") return { handle, dir, bearer: ownerToken };

  if (kind === "apikey-denied") {
    const key = await call(handle, "POST", "/api/auth/keys", { name: "agent" }, ownerToken);
    return { handle, dir, bearer: (key.json as { token: string }).token };
  }

  const scope = kind === "oauth-read" ? "vault:read" : "vault:write";
  const pair = handle.oauthStore.issueTokenPair({
    clientId: "matrix-test",
    scope,
    resource: "http://localhost/mcp",
  });
  return { handle, dir, bearer: pair.accessToken };
}

function bodyContains(json: unknown, needle: string): boolean {
  return JSON.stringify(json).includes(needle);
}

type RouteClass = "admin" | "strict" | "filtered" | "public";

interface RouteRow {
  name: string;
  class: RouteClass;
  exec: (f: Fixture) => Promise<{ status: number; json: unknown }>;
}

const ROUTES: RouteRow[] = [
  // ---- admin ----
  { name: "GET /api/settings", class: "admin", exec: (f) => call(f.handle, "GET", "/api/settings", undefined, f.bearer) },
  { name: "PATCH /api/settings", class: "admin", exec: (f) => call(f.handle, "PATCH", "/api/settings", {}, f.bearer) },
  { name: "GET /api/folder-mcp-perms", class: "admin", exec: (f) => call(f.handle, "GET", "/api/folder-mcp-perms", undefined, f.bearer) },
  { name: "POST /api/folder-mcp-perms", class: "admin", exec: (f) => call(f.handle, "POST", "/api/folder-mcp-perms", { path: "public", read: true, write: true }, f.bearer) },
  { name: "DELETE /api/folder-mcp-perms/public", class: "admin", exec: (f) => call(f.handle, "DELETE", "/api/folder-mcp-perms/public", undefined, f.bearer) },
  { name: "GET /api/auth/keys", class: "admin", exec: (f) => call(f.handle, "GET", "/api/auth/keys", undefined, f.bearer) },
  { name: "POST /api/auth/keys", class: "admin", exec: (f) => call(f.handle, "POST", "/api/auth/keys", { name: "another" }, f.bearer) },
  { name: "DELETE /api/auth/keys/:id", class: "admin", exec: (f) => call(f.handle, "DELETE", "/api/auth/keys/nonexistent", undefined, f.bearer) },
  {
    name: "POST /api/rag/test",
    class: "admin",
    // Unreachable port fails fast (connection refused) so requireOwner is
    // what every non-owner principal is actually tested against, not a
    // hanging network call; see item 3 (SSRF).
    exec: (f) =>
      call(
        f.handle,
        "POST",
        "/api/rag/test",
        { provider: "openai-compat", openaiCompat: { baseURL: "http://127.0.0.1:1", model: "x", dim: 8 } },
        f.bearer,
      ),
  },
  { name: "POST /api/rag/reindex", class: "admin", exec: (f) => call(f.handle, "POST", "/api/rag/reindex", undefined, f.bearer) },
  { name: "GET /api/git/status", class: "admin", exec: (f) => call(f.handle, "GET", "/api/git/status", undefined, f.bearer) },
  { name: "POST /api/git/commit", class: "admin", exec: (f) => call(f.handle, "POST", "/api/git/commit", {}, f.bearer) },
  { name: "POST /api/git/flush", class: "admin", exec: (f) => call(f.handle, "POST", "/api/git/flush", undefined, f.bearer) },
  { name: "POST /api/git/checkpoint", class: "admin", exec: (f) => call(f.handle, "POST", "/api/git/checkpoint", {}, f.bearer) },
  { name: "POST /api/git/autocommit", class: "admin", exec: (f) => call(f.handle, "POST", "/api/git/autocommit", { enabled: true }, f.bearer) },

  // ---- strict (target: secret/a.md or the secret/ folder) ----
  { name: "GET /api/note/secret/a.md", class: "strict", exec: (f) => call(f.handle, "GET", "/api/note/secret/a.md", undefined, f.bearer) },
  { name: "PUT /api/note/secret/a.md", class: "strict", exec: (f) => call(f.handle, "PUT", "/api/note/secret/a.md", { content: "x" }, f.bearer) },
  { name: "DELETE /api/note/secret/a.md", class: "strict", exec: (f) => call(f.handle, "DELETE", "/api/note/secret/a.md", undefined, f.bearer) },
  { name: "GET /api/backlinks/secret/a.md", class: "strict", exec: (f) => call(f.handle, "GET", "/api/backlinks/secret/a.md", undefined, f.bearer) },
  { name: "POST /api/rename", class: "strict", exec: (f) => call(f.handle, "POST", "/api/rename", { from: "secret/a.md", to: "secret/moved.md" }, f.bearer) },
  { name: "POST /api/folder/secret/newsub", class: "strict", exec: (f) => call(f.handle, "POST", "/api/folder/secret/newsub", undefined, f.bearer) },
  { name: "DELETE /api/folder/secret", class: "strict", exec: (f) => call(f.handle, "DELETE", "/api/folder/secret", undefined, f.bearer) },
  {
    name: "GET /api/media-raw/secret/.media/pic.png",
    class: "strict",
    exec: (f) => call(f.handle, "GET", "/api/media-raw/secret/.media/pic.png", undefined, f.bearer),
  },
  { name: "GET /api/git/log?path=secret/a.md", class: "strict", exec: (f) => call(f.handle, "GET", "/api/git/log?path=secret/a.md", undefined, f.bearer) },
  { name: "GET /api/git/show?path=secret/a.md", class: "strict", exec: (f) => call(f.handle, "GET", "/api/git/show?sha=HEAD&path=secret/a.md", undefined, f.bearer) },
  { name: "GET /api/git/diff?path=secret/a.md", class: "strict", exec: (f) => call(f.handle, "GET", "/api/git/diff?sha=HEAD&path=secret/a.md", undefined, f.bearer) },
  { name: "POST /api/git/restore secret/a.md", class: "strict", exec: (f) => call(f.handle, "POST", "/api/git/restore", { path: "secret/a.md", sha: "HEAD" }, f.bearer) },

  // ---- filtered (list/search routes: never 403, denied path just absent) ----
  { name: "GET /api/tree", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/tree", undefined, f.bearer) },
  { name: "GET /api/tags", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/tags", undefined, f.bearer) },
  { name: "GET /api/tags/notes?tag=secrettag", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/tags/notes?tag=secrettag", undefined, f.bearer) },
  { name: "GET /api/resolve?name=a", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/resolve?name=a", undefined, f.bearer) },
  { name: "GET /api/tasks", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/tasks", undefined, f.bearer) },
  { name: "GET /api/search?q=secret", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/search?q=secret", undefined, f.bearer) },
  { name: "GET /api/folder-meta", class: "filtered", exec: (f) => call(f.handle, "GET", "/api/folder-meta", undefined, f.bearer) },

  // ---- public (no folder scoping) ----
  { name: "GET /api/rag/status", class: "public", exec: (f) => call(f.handle, "GET", "/api/rag/status", undefined, f.bearer) },
];

const forbidden = (status: number) => status === 401 || status === 403;

describe("route x principal matrix (REST)", () => {
  for (const route of ROUTES) {
    describe(route.name, () => {
      for (const kind of PRINCIPALS) {
        test(kind, async () => {
          const f = await makeFixture(kind);
          const r = await route.exec(f);

          if (route.class === "admin") {
            if (kind === "owner" || kind === "open") expect(r.status).not.toBe(403);
            else expect(forbidden(r.status)).toBe(true);
            return;
          }

          if (route.class === "strict") {
            if (kind === "owner" || kind === "open") expect(r.status).not.toBe(403);
            else expect(forbidden(r.status)).toBe(true);
            return;
          }

          if (route.class === "filtered") {
            // Never forbidden outright, not even for oauth: REST still
            // 401s an OAuth bearer, but that's "unauthenticated", not this
            // route turning its own folder-perm filter into a 403.
            if (kind === "oauth-read" || kind === "oauth-write") {
              expect(r.status).toBe(401);
              return;
            }
            expect(r.status).toBe(200);
            if (kind === "owner" || kind === "open") {
              expect(bodyContains(r.json, "secret")).toBe(true);
            } else {
              expect(bodyContains(r.json, "secret/a.md")).toBe(false);
              expect(bodyContains(r.json, "secrettag")).toBe(false);
            }
            return;
          }

          // public
          if (kind === "oauth-read" || kind === "oauth-write") {
            expect(r.status).toBe(401);
          } else {
            expect(r.status).not.toBe(403);
            expect(r.status).not.toBe(401);
          }
        });
      }
    });
  }
});

// Web serving (anything not under /api/ or /mcp) never goes through
// auth-middleware at all (isProtected is false), on purpose: the login
// page itself has to load before anyone is authenticated. Every
// principal, including a bearer the API would 401, gets the same
// response here; this test env ships no built web/dist, so that
// response is a 404, never a 401/403.
describe("GET / (web serving, unauthenticated by design)", () => {
  for (const kind of PRINCIPALS) {
    test(kind, async () => {
      const f = await makeFixture(kind);
      const r = await call(f.handle, "GET", "/", undefined, f.bearer);
      expect(r.status).not.toBe(401);
      expect(r.status).not.toBe(403);
    });
  }
});

// Item 1 regression, kept out of the generic table above because a
// rejected directory path doesn't fit neatly into "403/401 forbidden":
// an agent credential's path must assertMarkdown first (400, not a note
// at all), it never even reaches a folder-perm check that a directory
// could satisfy on its parent's behalf. Only owner/open may pass a
// directory (or the vault root, path=".") and get the whole-vault log.
describe("GET /api/git/log?path=secret (directory, not a single note)", () => {
  for (const kind of PRINCIPALS) {
    test(kind, async () => {
      const f = await makeFixture(kind);
      const r = await call(f.handle, "GET", "/api/git/log?path=secret", undefined, f.bearer);
      if (kind === "owner" || kind === "open") {
        expect(r.status).toBe(200);
      } else {
        expect(r.status).not.toBe(200);
      }
    });
  }
});

// ---- MCP transport: OAuth scope is only meaningful here (REST never
// accepts an OAuth bearer at all, see the comment at the top of the file).

function appFetch(handle: AppHandle): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    handle.app.handle(new Request(input, init))) as unknown as typeof fetch;
}

async function mcpClient(handle: AppHandle, bearer?: string): Promise<Client> {
  const headers: Record<string, string> = {};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: appFetch(handle),
    requestInit: { headers },
  });
  const client = new Client({ name: "matrix-test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<{ isError?: boolean }> {
  return client.callTool({ name, arguments: args }) as Promise<{ isError?: boolean }>;
}

// Only "owner" bypasses folder perms over MCP (bypassesFolderPermsForMcp),
// "open" does not, see principal.ts's comment. This fixture never
// configures a folder-perm deny for the "open" principal at all (its early
// return in makeFixture above, before any /api/folder-mcp-perms call), so
// "open" still reads/writes everything through MCP, same as REST, just
// because nothing is denied yet, not because it bypasses the mechanism.
//
// secret/a.md isolates the FOLDER dimension (denied for every non-owner,
// non-open principal, oauth included, since bypassesFolderPermsForMcp is
// false for oauth too). public/b.md isolates the SCOPE dimension instead
// (not folder-denied for anyone), so an OAuth token's own read/write scope
// is what decides the outcome there, independent of folder perms.
interface McpRouteRow {
  name: string;
  exec: (client: Client) => Promise<{ isError?: boolean }>;
  expectError: (kind: PrincipalKind) => boolean;
}

const deniedByFolder = (kind: PrincipalKind) => kind !== "owner" && kind !== "open";

const MCP_ROUTES: McpRouteRow[] = [
  {
    name: "read_note secret/a.md (folder dimension)",
    exec: (c) => callTool(c, "read_note", { path: "secret/a.md" }),
    expectError: deniedByFolder,
  },
  {
    name: "write_note secret/a.md (folder dimension)",
    exec: (c) => callTool(c, "write_note", { path: "secret/a.md", content: "x" }),
    expectError: deniedByFolder,
  },
  {
    name: "read_note public/b.md (scope dimension)",
    exec: (c) => callTool(c, "read_note", { path: "public/b.md" }),
    expectError: (kind) => kind === "oauth-write",
  },
  {
    name: "write_note public/b.md (scope dimension)",
    exec: (c) => callTool(c, "write_note", { path: "public/b.md", content: "x" }),
    expectError: (kind) => kind === "oauth-read",
  },
];

describe("route x principal matrix (MCP transport)", () => {
  for (const route of MCP_ROUTES) {
    describe(route.name, () => {
      for (const kind of PRINCIPALS) {
        test(kind, async () => {
          const f = await makeFixture(kind);
          const client = await mcpClient(f.handle, f.bearer);
          const result = await route.exec(client);
          await client.close();
          expect(!!result.isError).toBe(route.expectError(kind));
        });
      }
    });
  }
});

// search_notes isolates the FOLDER dimension like read_note/write_note
// above, but as a list-style tool: it never errors outright, it just
// drops secret/a.md from an otherwise-successful result.
describe("route x principal matrix (MCP transport): search_notes is filtered, not forbidden", () => {
  for (const kind of PRINCIPALS) {
    test(kind, async () => {
      const f = await makeFixture(kind);
      const client = await mcpClient(f.handle, f.bearer);
      const result = (await callTool(client, "search_notes", { query: "body" })) as { isError?: boolean };
      await client.close();
      expect(result.isError).toBeFalsy();
      const text = JSON.stringify(result);
      if (kind === "owner" || kind === "open") {
        expect(text.includes("secret/a.md")).toBe(true);
      } else {
        expect(text.includes("secret/a.md")).toBe(false);
      }
    });
  }
});
