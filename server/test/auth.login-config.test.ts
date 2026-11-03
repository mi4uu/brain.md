import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadLoginConfig, validateLoginConfig, isAllowed, LoginConfigError } from "../src/auth/login-config";

const ENV_KEYS = [
  "BRAINMD_PASSWORD_LOGIN",
  "BRAINMD_PUBLIC_URL",
  "BRAINMD_OIDC_ISSUER",
  "BRAINMD_OIDC_CLIENT_ID",
  "BRAINMD_OIDC_CLIENT_SECRET",
  "BRAINMD_OIDC_NAME",
  "BRAINMD_OIDC_SCOPES",
  "BRAINMD_OIDC_GROUPS_CLAIM",
  "BRAINMD_OIDC_ALLOWED_GROUPS",
  "BRAINMD_GITHUB_CLIENT_ID",
  "BRAINMD_GITHUB_CLIENT_SECRET",
  "BRAINMD_OAUTH_ALLOWED_EMAILS",
  "BRAINMD_OAUTH_ALLOWED_DOMAINS",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("loadLoginConfig / validateLoginConfig", () => {
  test("default: password login on, no providers, validates fine", () => {
    const cfg = loadLoginConfig();
    expect(cfg.passwordLogin).toBe(true);
    expect(cfg.oidc).toBeUndefined();
    expect(cfg.github).toBeUndefined();
    expect(() => validateLoginConfig(cfg)).not.toThrow();
  });

  test("BRAINMD_PASSWORD_LOGIN=off with no provider refuses to start", () => {
    process.env.BRAINMD_PASSWORD_LOGIN = "off";
    const cfg = loadLoginConfig();
    expect(() => validateLoginConfig(cfg)).toThrow(LoginConfigError);
  });

  test("BRAINMD_PASSWORD_LOGIN=off with a provider + allowlist + public URL is fine", () => {
    process.env.BRAINMD_PASSWORD_LOGIN = "off";
    process.env.BRAINMD_GITHUB_CLIENT_ID = "id";
    process.env.BRAINMD_GITHUB_CLIENT_SECRET = "secret";
    process.env.BRAINMD_PUBLIC_URL = "https://vault.example.com";
    process.env.BRAINMD_OAUTH_ALLOWED_EMAILS = "me@example.com";
    const cfg = loadLoginConfig();
    expect(() => validateLoginConfig(cfg)).not.toThrow();
  });

  test("partial OIDC env (missing secret) throws", () => {
    process.env.BRAINMD_OIDC_ISSUER = "https://accounts.google.com";
    process.env.BRAINMD_OIDC_CLIENT_ID = "id";
    expect(() => loadLoginConfig()).toThrow(LoginConfigError);
  });

  test("partial GitHub env (missing client id) throws", () => {
    process.env.BRAINMD_GITHUB_CLIENT_SECRET = "secret";
    expect(() => loadLoginConfig()).toThrow(LoginConfigError);
  });

  test("a provider configured with no public URL refuses to start", () => {
    process.env.BRAINMD_GITHUB_CLIENT_ID = "id";
    process.env.BRAINMD_GITHUB_CLIENT_SECRET = "secret";
    process.env.BRAINMD_OAUTH_ALLOWED_EMAILS = "me@example.com";
    const cfg = loadLoginConfig();
    expect(() => validateLoginConfig(cfg)).toThrow(/BRAINMD_PUBLIC_URL/);
  });

  test("a provider configured with no allowlist refuses to start", () => {
    process.env.BRAINMD_GITHUB_CLIENT_ID = "id";
    process.env.BRAINMD_GITHUB_CLIENT_SECRET = "secret";
    process.env.BRAINMD_PUBLIC_URL = "https://vault.example.com";
    const cfg = loadLoginConfig();
    expect(() => validateLoginConfig(cfg)).toThrow(/allowlist/);
  });

  test("an OIDC groups allowlist counts as an allowlist", () => {
    process.env.BRAINMD_OIDC_ISSUER = "https://idp.example.com";
    process.env.BRAINMD_OIDC_CLIENT_ID = "id";
    process.env.BRAINMD_OIDC_CLIENT_SECRET = "secret";
    process.env.BRAINMD_OIDC_GROUPS_CLAIM = "groups";
    process.env.BRAINMD_OIDC_ALLOWED_GROUPS = "staff";
    process.env.BRAINMD_PUBLIC_URL = "https://vault.example.com";
    const cfg = loadLoginConfig();
    expect(() => validateLoginConfig(cfg)).not.toThrow();
  });

  test("a non-URL BRAINMD_PUBLIC_URL refuses to start", () => {
    process.env.BRAINMD_GITHUB_CLIENT_ID = "id";
    process.env.BRAINMD_GITHUB_CLIENT_SECRET = "secret";
    process.env.BRAINMD_OAUTH_ALLOWED_EMAILS = "me@example.com";
    process.env.BRAINMD_PUBLIC_URL = "not a url";
    const cfg = loadLoginConfig();
    expect(() => validateLoginConfig(cfg)).toThrow(/not a valid URL/);
  });

  test("a plain http:// BRAINMD_PUBLIC_URL on a real host refuses to start", () => {
    process.env.BRAINMD_GITHUB_CLIENT_ID = "id";
    process.env.BRAINMD_GITHUB_CLIENT_SECRET = "secret";
    process.env.BRAINMD_OAUTH_ALLOWED_EMAILS = "me@example.com";
    process.env.BRAINMD_PUBLIC_URL = "http://vault.example.com";
    const cfg = loadLoginConfig();
    expect(() => validateLoginConfig(cfg)).toThrow(/https/);
  });

  test("a plain http:// BRAINMD_PUBLIC_URL on localhost is allowed", () => {
    process.env.BRAINMD_GITHUB_CLIENT_ID = "id";
    process.env.BRAINMD_GITHUB_CLIENT_SECRET = "secret";
    process.env.BRAINMD_OAUTH_ALLOWED_EMAILS = "me@example.com";
    process.env.BRAINMD_PUBLIC_URL = "http://localhost:3000";
    const cfg = loadLoginConfig();
    expect(() => validateLoginConfig(cfg)).not.toThrow();
  });

  test("OIDC scopes default to openid email profile", () => {
    process.env.BRAINMD_OIDC_ISSUER = "https://idp.example.com";
    process.env.BRAINMD_OIDC_CLIENT_ID = "id";
    process.env.BRAINMD_OIDC_CLIENT_SECRET = "secret";
    const cfg = loadLoginConfig();
    expect(cfg.oidc?.scopes).toEqual(["openid", "email", "profile"]);
  });
});

describe("isAllowed", () => {
  test("matches by exact email, case-insensitively", () => {
    const cfg = loadLoginConfig();
    cfg.allowedEmails = ["me@example.com"];
    expect(isAllowed(cfg, { email: "ME@example.com" })).toBe(true);
    expect(isAllowed(cfg, { email: "other@example.com" })).toBe(false);
  });

  test("matches by domain", () => {
    const cfg = loadLoginConfig();
    cfg.allowedDomains = ["example.com"];
    expect(isAllowed(cfg, { email: "anyone@example.com" })).toBe(true);
    expect(isAllowed(cfg, { email: "anyone@other.com" })).toBe(false);
  });

  test("rejects a quoted local part that embeds an allowed domain", () => {
    const cfg = loadLoginConfig();
    cfg.allowedDomains = ["example.com"];
    expect(isAllowed(cfg, { email: '"a@example.com@b"@evil.test' })).toBe(false);
  });

  test("matches by OIDC group when configured", () => {
    const cfg = loadLoginConfig();
    cfg.oidc = {
      issuer: "https://idp.example.com",
      clientId: "id",
      clientSecret: "secret",
      name: "SSO",
      scopes: ["openid"],
      groupsClaim: "groups",
      allowedGroups: ["staff"],
    };
    expect(isAllowed(cfg, { email: "x@example.com", groups: ["staff"] })).toBe(true);
    expect(isAllowed(cfg, { email: "x@example.com", groups: ["guest"] })).toBe(false);
  });
});
