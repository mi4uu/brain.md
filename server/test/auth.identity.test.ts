import { describe, expect, test } from "bun:test";
import {
  identityContext,
  currentIdentity,
  localIdentity,
  apiKeyIdentity,
  oauthClientIdentity,
  LOCAL_SUB,
} from "../src/auth/identity";

describe("identity builders", () => {
  test("localIdentity defaults sub to local and kind to human", () => {
    const id = localIdentity("Michal", "michal@example.com");
    expect(id).toEqual({ sub: LOCAL_SUB, name: "Michal", email: "michal@example.com", kind: "human" });
  });

  test("localIdentity accepts an explicit sub", () => {
    const id = localIdentity("Michal", "michal@example.com", "local-2");
    expect(id.sub).toBe("local-2");
  });

  test("apiKeyIdentity mirrors the key name into clientName", () => {
    const id = apiKeyIdentity("apikey:abc123", "ci-bot");
    expect(id).toEqual({ sub: "apikey:abc123", name: "ci-bot", kind: "apikey", clientName: "ci-bot" });
  });

  // Regression: migrated legacy API keys all share sub === LOCAL_SUB
  // (see api-keys.ts load()), so without a credentialId keyed by the
  // key's own id, autocommit.ts's groupByActor collapses two unrelated
  // legacy keys into one commit, credited to whichever key's identity
  // was recorded first.
  test("apiKeyIdentity's credentialId is keyed by keyId when given, not sub", () => {
    const a = apiKeyIdentity(LOCAL_SUB, "legacy key 1", "aaaaaaaa");
    const b = apiKeyIdentity(LOCAL_SUB, "legacy key 2", "bbbbbbbb");
    expect(a.sub).toBe(b.sub);
    expect(a.credentialId).not.toBe(b.credentialId);
  });

  test("oauthClientIdentity mirrors the client name into clientName", () => {
    const id = oauthClientIdentity("oauth-sub", "Claude Desktop");
    expect(id).toEqual({
      sub: "oauth-sub",
      name: "Claude Desktop",
      kind: "oauth-client",
      clientName: "Claude Desktop",
      credentialId: "oauth-sub",
    });
  });

  // Regression: two different MCP clients consented with the same
  // password both get sub === LOCAL_SUB (see password-policy.ts), so
  // credentialId has to come from the client's own id, not the subject,
  // or autocommit.ts's grouping collapses them into one commit.
  test("oauthClientIdentity's credentialId is keyed by clientId when given, not sub", () => {
    const a = oauthClientIdentity(LOCAL_SUB, "Claude Desktop", "client-a");
    const b = oauthClientIdentity(LOCAL_SUB, "Cursor", "client-b");
    expect(a.sub).toBe(b.sub);
    expect(a.credentialId).not.toBe(b.credentialId);
  });
});

describe("identityContext (AsyncLocalStorage)", () => {
  test("currentIdentity() reflects the nearest run()", async () => {
    expect(currentIdentity()).toBeUndefined();
    const id = apiKeyIdentity("apikey:x", "key-x");
    await identityContext.run(id, async () => {
      expect(currentIdentity()).toEqual(id);
    });
    expect(currentIdentity()).toBeUndefined();
  });

  test("enterWith sets the store for the rest of the current context", () => {
    const id = localIdentity("Owner", "owner@brain.local");
    identityContext.enterWith(id);
    expect(currentIdentity()).toEqual(id);
  });
});
