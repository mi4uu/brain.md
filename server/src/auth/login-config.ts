// board-plan Part B: optional external login (OIDC + GitHub) alongside
// the V53 password login, which stays the default.
//
// Parsing is pure (reads process.env once per call, no side effects);
// validation is a separate step so callers that just want to inspect the
// shape (tests, /api/auth/config) don't have to catch an exception.

export interface OidcProviderConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  name: string;
  scopes: string[];
  groupsClaim?: string;
  allowedGroups?: string[];
}

export interface GithubProviderConfig {
  clientId: string;
  clientSecret: string;
}

export interface LoginConfig {
  passwordLogin: boolean;
  publicUrl?: string;
  oidc?: OidcProviderConfig;
  github?: GithubProviderConfig;
  allowedEmails: string[];
  allowedDomains: string[];
}

export class LoginConfigError extends Error {}

function csv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function boolEnv(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  return raw === "1" || raw.toLowerCase() === "true" || raw.toLowerCase() === "on";
}

function readOidc(): OidcProviderConfig | undefined {
  const issuer = process.env.BRAINMD_OIDC_ISSUER?.trim();
  const clientId = process.env.BRAINMD_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.BRAINMD_OIDC_CLIENT_SECRET?.trim();
  if (!issuer && !clientId && !clientSecret) return undefined;
  if (!issuer || !clientId || !clientSecret) {
    throw new LoginConfigError(
      "BRAINMD_OIDC_ISSUER, BRAINMD_OIDC_CLIENT_ID and BRAINMD_OIDC_CLIENT_SECRET must all be set to enable OIDC login",
    );
  }
  const name = process.env.BRAINMD_OIDC_NAME?.trim() || "SSO";
  const scopes = csv(process.env.BRAINMD_OIDC_SCOPES);
  const groupsClaim = process.env.BRAINMD_OIDC_GROUPS_CLAIM?.trim() || undefined;
  const allowedGroups = csv(process.env.BRAINMD_OIDC_ALLOWED_GROUPS);
  return {
    issuer,
    clientId,
    clientSecret,
    name,
    scopes: scopes.length > 0 ? scopes : ["openid", "email", "profile"],
    groupsClaim,
    allowedGroups: allowedGroups.length > 0 ? allowedGroups : undefined,
  };
}

function readGithub(): GithubProviderConfig | undefined {
  const clientId = process.env.BRAINMD_GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.BRAINMD_GITHUB_CLIENT_SECRET?.trim();
  if (!clientId && !clientSecret) return undefined;
  if (!clientId || !clientSecret) {
    throw new LoginConfigError(
      "BRAINMD_GITHUB_CLIENT_ID and BRAINMD_GITHUB_CLIENT_SECRET must both be set to enable GitHub login",
    );
  }
  return { clientId, clientSecret };
}

export function loadLoginConfig(): LoginConfig {
  return {
    passwordLogin: boolEnv("BRAINMD_PASSWORD_LOGIN", true),
    publicUrl: process.env.BRAINMD_PUBLIC_URL?.trim() || undefined,
    oidc: readOidc(),
    github: readGithub(),
    allowedEmails: csv(process.env.BRAINMD_OAUTH_ALLOWED_EMAILS).map((e) => e.toLowerCase()),
    allowedDomains: csv(process.env.BRAINMD_OAUTH_ALLOWED_DOMAINS).map((d) => d.toLowerCase()),
  };
}

export function hasExternalProvider(cfg: LoginConfig): boolean {
  return cfg.oidc !== undefined || cfg.github !== undefined;
}

// Throws LoginConfigError with a human-readable reason on any invalid
// combination. Called once at startup (index.ts) and by createApp(), so
// both the CLI and anything embedding the server fail the same way.
export function validateLoginConfig(cfg: LoginConfig): void {
  const external = hasExternalProvider(cfg);
  if (!cfg.passwordLogin && !external) {
    throw new LoginConfigError(
      "BRAINMD_PASSWORD_LOGIN=off requires at least one external login provider (OIDC or GitHub) to be configured",
    );
  }
  if (external) {
    if (!cfg.publicUrl) {
      throw new LoginConfigError(
        "BRAINMD_PUBLIC_URL is required when an external login provider is configured (used to build the OAuth redirect URI)",
      );
    }
    const hasGroupAllowlist = Boolean(cfg.oidc?.groupsClaim && cfg.oidc.allowedGroups);
    const hasAllowlist =
      cfg.allowedEmails.length > 0 || cfg.allowedDomains.length > 0 || hasGroupAllowlist;
    if (!hasAllowlist) {
      throw new LoginConfigError(
        "an external login provider is configured but no allowlist is set, set BRAINMD_OAUTH_ALLOWED_EMAILS, BRAINMD_OAUTH_ALLOWED_DOMAINS, or BRAINMD_OIDC_GROUPS_CLAIM + BRAINMD_OIDC_ALLOWED_GROUPS",
      );
    }
  }
}

// Shared allowlist check: email and group membership are both "is this
// person allowed in", independent of which provider vouched for them.
export function isAllowed(
  cfg: LoginConfig,
  identity: { email: string; groups?: string[] },
): boolean {
  const email = identity.email.toLowerCase();
  if (cfg.allowedEmails.includes(email)) return true;
  const domain = email.split("@")[1];
  if (domain && cfg.allowedDomains.includes(domain)) return true;
  if (cfg.oidc?.groupsClaim && cfg.oidc.allowedGroups && identity.groups) {
    if (identity.groups.some((g) => cfg.oidc!.allowedGroups!.includes(g))) return true;
  }
  return false;
}
