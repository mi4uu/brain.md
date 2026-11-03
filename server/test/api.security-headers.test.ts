import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";
import { CSP } from "../src/web/serve";

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-headers-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("baseline security headers — every response", () => {
  test("a normal JSON route gets nosniff + referrer-policy", async () => {
    const r = await handle.app.handle(new Request("http://localhost/health"));
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  test("a host-middleware short-circuit (400) still carries the headers", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/health", { headers: { host: "evil.example.com" } }),
    );
    expect(r.status).toBe(400);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  test("a 401 from auth-middleware still carries the headers", async () => {
    await handle.app.handle(
      new Request("http://localhost/api/auth/set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: "hunter2hunter2" }),
      }),
    );
    const r = await handle.app.handle(new Request("http://localhost/api/tree"));
    expect(r.status).toBe(401);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("Content-Security-Policy — HTML surfaces only", () => {
  test("the OAuth consent page carries the CSP", async () => {
    await handle.app.handle(
      new Request("http://localhost/api/auth/set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newPassword: "hunter2hunter2" }),
      }),
    );
    const reg = await handle.app.handle(
      new Request("http://localhost/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "test client",
          redirect_uris: ["https://example.com/cb"],
        }),
      }),
    );
    const { client_id } = await reg.json();
    const url =
      `http://localhost/oauth/authorize?response_type=code&client_id=${client_id}` +
      "&redirect_uri=https://example.com/cb&code_challenge=abc&code_challenge_method=S256" +
      "&resource=http://localhost/mcp";
    const r = await handle.app.handle(new Request(url));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toBe(CSP);
  });

  test("CSP defines the expected baseline directives", () => {
    expect(CSP).toContain("default-src 'self'");
    expect(CSP).toContain("script-src 'self'");
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("base-uri 'self'");
    expect(CSP).toContain("frame-ancestors 'none'");
    expect(CSP).toContain("form-action 'self'");
    // style-src needs 'unsafe-inline' for CodeMirror/KaTeX/highlight.js —
    // see the comment on CSP in web/serve.ts.
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'");
  });

  test("a plain JSON route has no CSP (not a document the browser renders)", async () => {
    const r = await handle.app.handle(new Request("http://localhost/health"));
    expect(r.headers.get("content-security-policy")).toBeNull();
  });
});
