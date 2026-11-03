import { createRemoteJWKSet, jwtVerify } from "jose";
import type { OidcProviderConfig } from "./login-config";

// Board-plan Part B: a minimal OIDC relying-party client. Covers exactly
// what login needs (authorization_code + PKCE, ID token validation), not
// a general OIDC SDK. Works against Google, Keycloak, Authentik and
// Microsoft Entra ID, which all speak standard discovery + JWKS.

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
}

export interface OidcIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  groups?: string[];
}

export class OidcDiscoveryError extends Error {}

export class OidcProvider {
  readonly cfg: OidcProviderConfig;
  private discovery?: DiscoveryDocument;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(cfg: OidcProviderConfig) {
    this.cfg = cfg;
  }

  // Fetched once at startup and cached for the process lifetime, the
  // discovery document practically never changes, and refetching it on
  // every login would add a round trip to the critical path for nothing.
  async discover(): Promise<DiscoveryDocument> {
    if (this.discovery) return this.discovery;
    const issuer = this.cfg.issuer.replace(/\/+$/, "");
    const url = `${issuer}/.well-known/openid-configuration`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new OidcDiscoveryError(
        `failed to fetch OIDC discovery document from ${url}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (!res.ok) {
      throw new OidcDiscoveryError(`OIDC discovery document ${url} returned ${res.status}`);
    }
    const doc = (await res.json()) as DiscoveryDocument;
    if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
      throw new OidcDiscoveryError(`OIDC discovery document ${url} is missing required fields`);
    }
    this.discovery = doc;
    return doc;
  }

  private async getJwks() {
    if (!this.jwks) {
      const doc = await this.discover();
      this.jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
    }
    return this.jwks;
  }

  async buildAuthorizationUrl(params: {
    state: string;
    codeChallenge: string;
    nonce: string;
    redirectUri: string;
  }): Promise<URL> {
    const doc = await this.discover();
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.cfg.clientId);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("scope", this.cfg.scopes.join(" "));
    url.searchParams.set("state", params.state);
    url.searchParams.set("nonce", params.nonce);
    url.searchParams.set("code_challenge", params.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url;
  }

  // Exchanges the authorization code for tokens, then validates the ID
  // token (iss, aud, exp, nonce, signature via JWKS) and requires
  // email_verified === true, per the task spec. Returns the identity the
  // provider vouches for.
  async exchangeAndValidate(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
    nonce: string;
  }): Promise<OidcIdentity> {
    const doc = await this.discover();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: this.cfg.clientId,
      client_secret: this.cfg.clientSecret,
      code_verifier: params.codeVerifier,
    });
    const res = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      throw new Error(`token endpoint returned ${res.status}`);
    }
    const tokenResponse = (await res.json()) as { id_token?: string };
    if (!tokenResponse.id_token) {
      throw new Error("token response is missing id_token");
    }

    // doc.issuer comes straight from the discovery document, which is
    // fetched over plain HTTPS trust with no further check that it's
    // actually the issuer we configured. A discovery document served
    // from a compromised or misconfigured path could claim any issuer,
    // and jwtVerify would happily accept tokens for it. Compare against
    // the admin-configured value, not the document's own say-so.
    const configuredIssuer = this.cfg.issuer.replace(/\/+$/, "");
    if (doc.issuer.replace(/\/+$/, "") !== configuredIssuer) {
      throw new Error(
        `OIDC discovery document issuer (${doc.issuer}) does not match the configured issuer (${this.cfg.issuer})`,
      );
    }

    const jwks = await this.getJwks();
    const { payload } = await jwtVerify(tokenResponse.id_token, jwks, {
      issuer: doc.issuer,
      audience: this.cfg.clientId,
      requiredClaims: ["exp", "iat", "sub"],
    });

    if (payload.nonce !== params.nonce) {
      throw new Error("ID token nonce does not match the login flow");
    }
    const email = typeof payload.email === "string" ? payload.email : undefined;
    if (!email) {
      throw new Error("ID token is missing an email claim");
    }
    if (payload.email_verified !== true) {
      throw new Error("ID token's email_verified claim is not true");
    }
    const sub = typeof payload.sub === "string" ? payload.sub : undefined;
    if (!sub) {
      throw new Error("ID token is missing sub");
    }
    let groups: string[] | undefined;
    if (this.cfg.groupsClaim) {
      const raw = payload[this.cfg.groupsClaim];
      if (Array.isArray(raw)) groups = raw.filter((g): g is string => typeof g === "string");
    }
    const name = typeof payload.name === "string" ? payload.name : undefined;
    return { sub, email, emailVerified: true, name, groups };
  }
}
