import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createApp, type AppHandle } from "../src/app";

// tests-code-F1: POST /oauth/token (both grant types) had zero route-level
// coverage; existing tests drive OAuthStore directly, bypassing body
// parsing and the route's own validation. This exercises the real HTTP
// path: register -> authorize (consent) -> code -> /oauth/token.

const RESOURCE = "http://localhost/mcp";
const REDIRECT_URI = "https://example.com/cb";

let handle!: AppHandle;
let dir!: string;
let nowSpy: ReturnType<typeof spyOn> | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brain-oauth-token-"));
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
  nowSpy?.mockRestore();
  nowSpy = undefined;
  await rm(dir, { recursive: true, force: true });
});

function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function register(): Promise<string> {
  const res = await handle.app.handle(
    new Request("http://localhost/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "test client", redirect_uris: [REDIRECT_URI] }),
    }),
  );
  const { client_id } = await res.json();
  return client_id;
}

// Full authorize -> consent -> code round trip, over real HTTP, with a
// fresh PKCE verifier each call so codes from different tests never collide.
async function getCode(clientId: string, verifier: string): Promise<string> {
  const res = await handle.app.handle(
    new Request("http://localhost/oauth/authorize", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        scope: "vault:read",
        state: "xyz",
        code_challenge: pkce(verifier),
        resource: RESOURCE,
        decision: "allow",
        password: "correct-password",
      }).toString(),
    }),
  );
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location")!);
  const code = location.searchParams.get("code");
  if (!code) throw new Error("expected a code in the redirect");
  return code;
}

function postToken(form: Record<string, string>) {
  return handle.app.handle(
    new Request("http://localhost/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    }),
  );
}

describe("POST /oauth/token: authorization_code grant", () => {
  test("a valid code with the matching verifier exchanges for a token pair", async () => {
    const clientId = await register();
    const verifier = "verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const code = await getCode(clientId, verifier);

    const res = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.token_type).toBe("Bearer");
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.refresh_token).toBe("string");
    expect(body.scope).toBe("vault:read");
  });

  test("the wrong code_verifier fails PKCE verification", async () => {
    const clientId = await register();
    const verifier = "verifier-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const code = await getCode(clientId, verifier);

    const res = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: "not-the-right-verifier-not-the-right-verifier-aa",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
  });

  test("a code cannot be redeemed twice", async () => {
    const clientId = await register();
    const verifier = "verifier-cccccccccccccccccccccccccccccccccccccccccccccc";
    const code = await getCode(clientId, verifier);
    const form = {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    };

    const first = await postToken(form);
    expect(first.status).toBe(200);

    const second = await postToken(form);
    expect(second.status).toBe(400);
    const body = await second.json();
    expect(body.error).toBe("invalid_grant");
  });

  test("an expired code is rejected", async () => {
    const start = 1_700_000_000_000;
    nowSpy = spyOn(Date, "now").mockReturnValue(start);
    const clientId = await register();
    const verifier = "verifier-dddddddddddddddddddddddddddddddddddddddddddddd";
    const code = await getCode(clientId, verifier);

    // CODE_TTL_MS is 60s.
    nowSpy.mockReturnValue(start + 60_000 + 1);
    const res = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
  });

  test("the wrong client_id is rejected", async () => {
    const clientId = await register();
    const otherClientId = await register();
    const verifier = "verifier-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    const code = await getCode(clientId, verifier);

    const res = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: otherClientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
  });

  test("the wrong redirect_uri is rejected", async () => {
    const clientId = await register();
    const verifier = "verifier-ffffffffffffffffffffffffffffffffffffffffffffff";
    const code = await getCode(clientId, verifier);

    const res = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: "https://not-the-registered-uri.example.com/cb",
      resource: RESOURCE,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
  });

  test("a missing required parameter is a 400 before the store is even consulted", async () => {
    const clientId = await register();
    const res = await postToken({
      grant_type: "authorization_code",
      code: "whatever",
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
      // code_verifier omitted
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });
});

describe("POST /oauth/token: refresh_token grant", () => {
  async function issuePair(): Promise<{ clientId: string; accessToken: string; refreshToken: string }> {
    const clientId = await register();
    const verifier = "verifier-gggggggggggggggggggggggggggggggggggggggggggggg";
    const code = await getCode(clientId, verifier);
    const res = await postToken({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      resource: RESOURCE,
    });
    const body = await res.json();
    return { clientId, accessToken: body.access_token, refreshToken: body.refresh_token };
  }

  test("a valid refresh_token rotates to a new token pair", async () => {
    const { clientId, refreshToken } = await issuePair();
    const res = await postToken({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.refresh_token).toBe("string");
    expect(body.refresh_token).not.toBe(refreshToken);
  });

  test("replaying a rotated-out refresh token is rejected and revokes the family", async () => {
    const { clientId, accessToken, refreshToken } = await issuePair();
    const rotated = await postToken({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    expect(rotated.status).toBe(200);
    const rotatedBody = await rotated.json();

    const replay = await postToken({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId });
    expect(replay.status).toBe(400);
    const replayBody = await replay.json();
    expect(replayBody.error).toBe("invalid_grant");

    // The whole family is dead: neither the original access token nor
    // the one minted by the rotation above still work.
    const mcpOriginal = await handle.app.handle(
      new Request("http://localhost/mcp", { headers: { authorization: `Bearer ${accessToken}` } }),
    );
    expect(mcpOriginal.status).not.toBe(200);
    const mcpRotated = await handle.app.handle(
      new Request("http://localhost/mcp", { headers: { authorization: `Bearer ${rotatedBody.access_token}` } }),
    );
    expect(mcpRotated.status).not.toBe(200);
  });

  test("the wrong client_id is rejected", async () => {
    const { refreshToken } = await issuePair();
    const otherClientId = await register();
    const res = await postToken({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: otherClientId });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_grant");
  });

  test("a missing refresh_token or client_id is a 400", async () => {
    const { clientId } = await issuePair();
    const res = await postToken({ grant_type: "refresh_token", client_id: clientId });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_request");
  });
});

describe("POST /oauth/token: unsupported grant_type", () => {
  test("an unknown grant_type is rejected", async () => {
    const res = await postToken({ grant_type: "client_credentials" });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("unsupported_grant_type");
  });
});
