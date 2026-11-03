import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { OAuthStore } from "../src/auth/oauth-store";
import { LOCAL_SUB } from "../src/auth/identity";

function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("OAuthStore — sub plumbing", () => {
  test("issueCode defaults sub to local; consumeCode returns it", () => {
    const store = new OAuthStore();
    const verifier = "verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const code = store.issueCode({
      clientId: "client-1",
      redirectUri: "https://example.com/cb",
      scope: "vault:read",
      codeChallenge: pkce(verifier),
      codeChallengeMethod: "S256",
      resource: "https://example.com/mcp",
    });
    const consumed = store.consumeCode(code, {
      clientId: "client-1",
      redirectUri: "https://example.com/cb",
      codeVerifier: verifier,
      resource: "https://example.com/mcp",
    });
    expect(consumed.ok).toBe(true);
    if (consumed.ok) expect(consumed.sub).toBe(LOCAL_SUB);
  });

  test("issueCode(sub) carries a custom subject through to the access token", () => {
    const store = new OAuthStore();
    const verifier = "verifier-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const code = store.issueCode({
      clientId: "client-2",
      redirectUri: "https://example.com/cb",
      scope: "vault:write",
      codeChallenge: pkce(verifier),
      codeChallengeMethod: "S256",
      resource: "https://example.com/mcp",
      sub: "custom-sub",
    });
    const consumed = store.consumeCode(code, {
      clientId: "client-2",
      redirectUri: "https://example.com/cb",
      codeVerifier: verifier,
      resource: "https://example.com/mcp",
    });
    expect(consumed.ok).toBe(true);
    if (!consumed.ok) throw new Error("expected ok");
    const pair = store.issueTokenPair({
      clientId: "client-2",
      scope: consumed.scope,
      resource: consumed.resource,
      sub: consumed.sub,
    });
    const v = store.validateAccess(pair.accessToken, "https://example.com/mcp");
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.sub).toBe("custom-sub");
      expect(v.clientId).toBe("client-2");
    }
  });

  test("issueTokenPair defaults sub to local when none is given", () => {
    const store = new OAuthStore();
    const pair = store.issueTokenPair({ clientId: "client-3", scope: "vault:read", resource: "r" });
    const v = store.validateAccess(pair.accessToken, "r");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.sub).toBe(LOCAL_SUB);
  });

  test("refreshTokenPair carries the original sub forward", () => {
    const store = new OAuthStore();
    const pair = store.issueTokenPair({
      clientId: "client-4",
      scope: "vault:read",
      resource: "r",
      sub: "sub-4",
    });
    const refreshed = store.refreshTokenPair({ refreshToken: pair.refreshToken, clientId: "client-4" });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) throw new Error("expected ok");
    const v = store.validateAccess(refreshed.pair.accessToken, "r");
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.sub).toBe("sub-4");
  });
});
