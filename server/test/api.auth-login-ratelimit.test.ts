import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, type AppHandle } from "../src/app";

let handle!: AppHandle;
let dir!: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-login-rl-"));
  handle = createApp({ vaultDir: dir, gitAutocommit: false });
  await handle.app.handle(
    new Request("http://localhost/api/auth/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ newPassword: "correct-password" }),
    }),
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function login(password: string, ip: string) {
  return handle.app.handle(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ password }),
    }),
  );
}

describe("POST /api/auth/login — brute-force protection", () => {
  test("5 wrong passwords from one IP are 401, the 6th is 429 with Retry-After", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await login("wrong", "1.1.1.1");
      expect(r.status).toBe(401);
    }
    const blocked = await login("wrong", "1.1.1.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).not.toBeNull();
    const j = await blocked.json();
    expect(j.code).toBe("RATE_LIMITED");
  });

  test("a 429'd IP is still blocked even with the correct password", async () => {
    for (let i = 0; i < 5; i++) await login("wrong", "2.2.2.2");
    const r = await login("correct-password", "2.2.2.2");
    expect(r.status).toBe(429);
  });

  test("a successful login resets the IP's counter", async () => {
    for (let i = 0; i < 4; i++) {
      const r = await login("wrong", "3.3.3.3");
      expect(r.status).toBe(401);
    }
    const ok = await login("correct-password", "3.3.3.3");
    expect(ok.status).toBe(200);
    // Counter reset: 4 more wrong guesses shouldn't trip the limiter yet.
    for (let i = 0; i < 4; i++) {
      const r = await login("wrong", "3.3.3.3");
      expect(r.status).toBe(401);
    }
    const stillOk = await login("correct-password", "3.3.3.3");
    expect(stillOk.status).toBe(200);
  });

  test("a different IP is unaffected by another IP's failures", async () => {
    for (let i = 0; i < 6; i++) await login("wrong", "4.4.4.4");
    const r = await login("correct-password", "5.5.5.5");
    expect(r.status).toBe(200);
  });
});
