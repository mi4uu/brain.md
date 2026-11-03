import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GithubProvider } from "../src/auth/github-provider";

// GithubProvider talks to github.com + api.github.com through the global
// fetch, which arctic also uses internally, mock it rather than hit the
// network, same approach the task spec asks for.

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(opts: { primaryVerified: boolean }) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return new Response(JSON.stringify({ access_token: "gh-access-token", token_type: "bearer" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === "https://api.github.com/user") {
      return new Response(JSON.stringify({ id: 42, name: "Alice", login: "alice" }), { status: 200 });
    }
    if (url === "https://api.github.com/user/emails") {
      return new Response(
        JSON.stringify([
          { email: "alice@noreply.example.com", primary: false, verified: true },
          {
            email: "alice@example.com",
            primary: true,
            verified: opts.primaryVerified,
          },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as typeof fetch;
}

describe("GithubProvider.exchangeAndValidate", () => {
  test("returns the primary verified email", async () => {
    mockFetch({ primaryVerified: true });
    const provider = new GithubProvider(
      { clientId: "id", clientSecret: "secret" },
      "https://vault.example.com/api/auth/idp/github/callback",
    );
    const identity = await provider.exchangeAndValidate("some-code");
    expect(identity).toEqual({ id: "42", email: "alice@example.com", name: "Alice" });
  });

  test("rejects when the primary email is not verified", async () => {
    mockFetch({ primaryVerified: false });
    const provider = new GithubProvider(
      { clientId: "id", clientSecret: "secret" },
      "https://vault.example.com/api/auth/idp/github/callback",
    );
    await expect(provider.exchangeAndValidate("some-code")).rejects.toThrow(/verified/);
  });
});
