import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { OAuthStore } from "../src/auth/oauth-store";

function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// tests-code-F2: revokeFamily and sweepExpired had zero coverage. Both
// are private, exercised here only through the public methods that
// drive them (refreshTokenPair for revokeFamily, sweepExpired directly
// since it's the maintenance entry point startSweeper's timer calls).

describe("OAuthStore: refresh-token-theft revocation (revokeFamily)", () => {
  test("replaying a rotated-out refresh token kills the whole family, including the sibling access token", () => {
    const store = new OAuthStore();
    const pair1 = store.issueTokenPair({ clientId: "client-1", scope: "vault:read", resource: "r" });

    // Normal rotation: refresh1 -> pair2. refresh1 is now a tombstone
    // (consumedRefresh), not a theft indicator by itself.
    const rotated = store.refreshTokenPair({ refreshToken: pair1.refreshToken, clientId: "client-1" });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) throw new Error("expected ok");
    const pair2 = rotated.pair;

    // pair2's access token is live before the replay.
    expect(store.validateAccess(pair2.accessToken, "r").ok).toBe(true);

    // Replaying the dead refresh1 is the theft signal: revoke the whole
    // family, which pair2 (access2 + refresh2) descends from.
    const replay = store.refreshTokenPair({ refreshToken: pair1.refreshToken, clientId: "client-1" });
    expect(replay.ok).toBe(false);

    const v = store.validateAccess(pair2.accessToken, "r");
    expect(v.ok).toBe(false);

    const reuse = store.refreshTokenPair({ refreshToken: pair2.refreshToken, clientId: "client-1" });
    expect(reuse.ok).toBe(false);
  });

  test("replaying a refresh token from an unrelated family does not touch it", () => {
    const store = new OAuthStore();
    const pairA = store.issueTokenPair({ clientId: "client-a", scope: "vault:read", resource: "r" });
    const pairB = store.issueTokenPair({ clientId: "client-b", scope: "vault:read", resource: "r" });

    const rotatedA = store.refreshTokenPair({ refreshToken: pairA.refreshToken, clientId: "client-a" });
    expect(rotatedA.ok).toBe(true);

    // Replay family A's dead token; family B must be unaffected.
    store.refreshTokenPair({ refreshToken: pairA.refreshToken, clientId: "client-a" });
    expect(store.validateAccess(pairB.accessToken, "r").ok).toBe(true);
  });
});

describe("OAuthStore: sweepExpired", () => {
  let nowSpy: ReturnType<typeof spyOn> | undefined;

  afterEach(() => {
    nowSpy?.mockRestore();
    nowSpy = undefined;
  });

  test("removes an expired authorization code, keeps a live one", () => {
    const start = 1_700_000_000_000;
    nowSpy = spyOn(Date, "now").mockReturnValue(start);
    const store = new OAuthStore();
    const verifier = "verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    store.issueCode({
      clientId: "client-1",
      redirectUri: "https://example.com/cb",
      scope: "vault:read",
      codeChallenge: pkce(verifier),
      codeChallengeMethod: "S256",
      resource: "r",
    });
    expect(store.stats().codes).toBe(1);

    // CODE_TTL_MS is 60s, well past it.
    nowSpy.mockReturnValue(start + 60_000 + 1);
    store.issueCode({
      clientId: "client-2",
      redirectUri: "https://example.com/cb",
      scope: "vault:read",
      codeChallenge: pkce(verifier),
      codeChallengeMethod: "S256",
      resource: "r",
    });
    expect(store.stats().codes).toBe(2);

    store.sweepExpired();
    expect(store.stats().codes).toBe(1);
  });

  test("removes an expired access token but keeps its still-live refresh token", () => {
    const start = 1_700_000_000_000;
    nowSpy = spyOn(Date, "now").mockReturnValue(start);
    const store = new OAuthStore();
    store.issueTokenPair({ clientId: "client-1", scope: "vault:read", resource: "r" });
    expect(store.stats()).toEqual({ codes: 0, access: 1, refresh: 1, consumedRefresh: 0 });

    // ACCESS_TTL_MS is 24h, REFRESH_TTL_MS is 7d: this moves past the
    // first without reaching the second.
    nowSpy.mockReturnValue(start + 24 * 60 * 60 * 1000 + 1);
    store.sweepExpired();
    expect(store.stats()).toEqual({ codes: 0, access: 0, refresh: 1, consumedRefresh: 0 });
  });

  test("removes an expired refresh token", () => {
    const start = 1_700_000_000_000;
    nowSpy = spyOn(Date, "now").mockReturnValue(start);
    const store = new OAuthStore();
    store.issueTokenPair({ clientId: "client-1", scope: "vault:read", resource: "r" });

    // Past REFRESH_TTL_MS (7d).
    nowSpy.mockReturnValue(start + 7 * 24 * 60 * 60 * 1000 + 1);
    store.sweepExpired();
    expect(store.stats()).toEqual({ codes: 0, access: 0, refresh: 0, consumedRefresh: 0 });
  });

  test("removes a stale consumedRefresh tombstone but keeps a fresh one", () => {
    const start = 1_700_000_000_000;
    nowSpy = spyOn(Date, "now").mockReturnValue(start);
    const store = new OAuthStore();
    const pairOld = store.issueTokenPair({ clientId: "client-1", scope: "vault:read", resource: "r" });
    // Rotating creates a consumedRefresh tombstone for pairOld.refreshToken,
    // expiring at pairOld's original REFRESH_TTL_MS deadline (start + 7d).
    store.refreshTokenPair({ refreshToken: pairOld.refreshToken, clientId: "client-1" });
    expect(store.stats().consumedRefresh).toBe(1);

    // Move to just before pairOld's tombstone expires, then rotate again
    // so the new refresh token's own tombstone (fresh) coexists with the
    // old one (about to die).
    nowSpy.mockReturnValue(start + 7 * 24 * 60 * 60 * 1000 - 1);
    const pair2 = store.issueTokenPair({ clientId: "client-1", scope: "vault:read", resource: "r" });
    store.refreshTokenPair({ refreshToken: pair2.refreshToken, clientId: "client-1" });
    expect(store.stats().consumedRefresh).toBe(2);

    // Now cross pairOld's tombstone deadline only.
    nowSpy.mockReturnValue(start + 7 * 24 * 60 * 60 * 1000 + 1);
    store.sweepExpired();
    expect(store.stats().consumedRefresh).toBe(1);
  });
});
