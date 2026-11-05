import { GitHub } from "arctic";
import type { GithubProviderConfig } from "./login-config";

// Board-plan Part B: GitHub has no OIDC discovery, so it gets its own
// small wrapper instead of going through oidc-provider.ts. arctic handles
// the authorization-code exchange; we handle the GitHub-specific "which
// email is primary and verified" lookup ourselves.

export interface GithubIdentity {
  id: string;
  email: string;
  name?: string;
}

interface GithubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

interface GithubUser {
  id: number;
  name: string | null;
  login: string;
}

export class GithubProvider {
  private readonly client: GitHub;

  constructor(cfg: GithubProviderConfig, redirectUri: string) {
    this.client = new GitHub(cfg.clientId, cfg.clientSecret, redirectUri);
  }

  buildAuthorizationUrl(state: string): URL {
    // GitHub's OAuth app flow doesn't use PKCE (it's a confidential
    // client, the secret is proof enough), so only state is passed.
    return this.client.createAuthorizationURL(state, ["read:user", "user:email"]);
  }

  async exchangeAndValidate(code: string): Promise<GithubIdentity> {
    const tokens = await this.client.validateAuthorizationCode(code);
    const accessToken = tokens.accessToken();

    const headers = {
      authorization: `Bearer ${accessToken}`,
      "user-agent": "brain.md",
      accept: "application/vnd.github+json",
    };

    const userRes = await fetch("https://api.github.com/user", { headers });
    if (!userRes.ok) throw new Error(`GitHub /user returned ${userRes.status}`);
    const user = (await userRes.json()) as GithubUser;

    const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
    if (!emailsRes.ok) throw new Error(`GitHub /user/emails returned ${emailsRes.status}`);
    const emails = (await emailsRes.json()) as GithubEmail[];
    const primary = emails.find((e) => e.primary && e.verified);
    if (!primary) {
      throw new Error("GitHub account has no verified primary email");
    }

    return { id: String(user.id), email: primary.email, name: user.name ?? user.login };
  }
}
