import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

// Regression for Codex r2 #9: the default @elysiajs/cors reflects back
// whatever Origin a request sends, equivalent to allowing any origin.

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-cors-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("CORS does not reflect arbitrary origins", () => {
  test("a foreign origin gets no Access-Control-Allow-Origin", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/health", {
        headers: { origin: "https://evil.example.com" },
      }),
    );
    expect(r.headers.get("access-control-allow-origin")).not.toBe("https://evil.example.com");
  });

  test("a loopback dev origin is allowed", async () => {
    const r = await handle.app.handle(
      new Request("http://localhost/health", {
        headers: { origin: "http://localhost:5173" },
      }),
    );
    expect(r.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
  });

  test("an origin in ALLOWED_HOSTS is allowed", async () => {
    handle = createApp({
      vaultDir: dir,
      gitAutocommit: false,
      allowedHosts: ["localhost", "127.0.0.1", "[::1]", "brain.example.com"],
    });
    const r = await handle.app.handle(
      new Request("http://localhost/health", {
        headers: { origin: "https://brain.example.com" },
      }),
    );
    expect(r.headers.get("access-control-allow-origin")).toBe("https://brain.example.com");
  });
});
