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

  test("oauthClientIdentity mirrors the client name into clientName", () => {
    const id = oauthClientIdentity("oauth-sub", "Claude Desktop");
    expect(id).toEqual({ sub: "oauth-sub", name: "Claude Desktop", kind: "oauth-client", clientName: "Claude Desktop" });
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
