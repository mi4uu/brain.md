import { randomBytes, timingSafeEqual } from "node:crypto";

// V63 step 3: Dynamic Client Registration store (RFC 7591).
//
// MCP clients that don't have a prior relationship with this server can
// POST /oauth/register with a JSON body declaring their redirect_uris and
// client_name; we mint a client_id (and skip client_secret — every MCP
// client we care about is public, PKCE is the only credential).
//
// Persistence: in-memory, same as the rest of the auth surface. The
// rationale matches V53 — single-user single-device, restart = fresh.
// Step 4 may add Settings → Security → "Registered clients" with persist
// + revoke, but the spec doesn't require persistence; clients re-register
// after a restart, which costs them one extra round trip and nothing else.

export interface RegisteredClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  client_id_issued_at: number;
  registration_access_token: string;
}

export interface ClientRegistrationRequest {
  client_name?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

function isValidRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") {
    return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  }
  return false;
}

function constantTimeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// Unbounded DCR self-registration (any client can POST /oauth/register with
// no auth) would otherwise let a registration loop grow this in-memory map
// without bound. Capped with LRU-by-last-use eviction instead.
const MAX_CLIENTS = 500;

export class OAuthClientStore {
  private readonly clients = new Map<string, RegisteredClient>();
  private readonly lastUsedAt = new Map<string, number>();

  private touch(clientId: string): void {
    this.lastUsedAt.set(clientId, Date.now());
  }

  private pruneIfFull(): void {
    if (this.clients.size < MAX_CLIENTS) return;
    const byAge = Array.from(this.clients.keys()).sort((a, b) => {
      const ageA = this.lastUsedAt.get(a) ?? this.clients.get(a)!.client_id_issued_at * 1000;
      const ageB = this.lastUsedAt.get(b) ?? this.clients.get(b)!.client_id_issued_at * 1000;
      return ageA - ageB;
    });
    // Evict enough of the stalest, least-recently-used registrations to
    // make room for the one about to be registered.
    const evictCount = this.clients.size - MAX_CLIENTS + 1;
    for (const id of byAge.slice(0, evictCount)) {
      this.clients.delete(id);
      this.lastUsedAt.delete(id);
    }
  }

  register(req: ClientRegistrationRequest):
    | { ok: true; client: RegisteredClient }
    | { ok: false; error: string; error_description: string } {
    if (!Array.isArray(req.redirect_uris) || req.redirect_uris.length === 0) {
      return {
        ok: false,
        error: "invalid_redirect_uri",
        error_description: "redirect_uris must be a non-empty array",
      };
    }
    for (const uri of req.redirect_uris) {
      if (typeof uri !== "string" || !isValidRedirect(uri)) {
        return {
          ok: false,
          error: "invalid_redirect_uri",
          error_description: `redirect_uri rejected: ${uri} (must be https:// or http://localhost)`,
        };
      }
    }
    // Drop grants we don't support (e.g. jwt-bearer) instead of rejecting the
    // registration. Only authorization_code is required for the flow we run.
    const declaredGrants = req.grant_types ?? ["authorization_code", "refresh_token"];
    const allowedGrants = new Set(["authorization_code", "refresh_token"]);
    const grantTypes = declaredGrants.filter((g) => allowedGrants.has(g));
    if (!grantTypes.includes("authorization_code")) {
      return {
        ok: false,
        error: "invalid_client_metadata",
        error_description: "client must support authorization_code grant",
      };
    }
    const responseTypes = req.response_types ?? ["code"];
    for (const r of responseTypes) {
      if (r !== "code") {
        return {
          ok: false,
          error: "invalid_client_metadata",
          error_description: `response_type not supported: ${r}`,
        };
      }
    }
    const auth = req.token_endpoint_auth_method ?? "none";
    if (auth !== "none") {
      // We're a public-client server (PKCE-only). Reject confidential
      // client registrations rather than silently downgrading.
      return {
        ok: false,
        error: "invalid_client_metadata",
        error_description: "token_endpoint_auth_method must be 'none' (PKCE-only public clients)",
      };
    }

    const client: RegisteredClient = {
      client_id: `mcp-${randomBytes(16).toString("hex")}`,
      client_name: typeof req.client_name === "string" && req.client_name.length > 0
        ? req.client_name.slice(0, 200)
        : "Unnamed MCP client",
      redirect_uris: req.redirect_uris.slice(),
      grant_types: grantTypes,
      response_types: responseTypes,
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(Date.now() / 1000),
      registration_access_token: randomBytes(32).toString("base64url"),
    };
    this.pruneIfFull();
    this.clients.set(client.client_id, client);
    this.touch(client.client_id);
    return { ok: true, client };
  }

  get(clientId: string): RegisteredClient | undefined {
    const c = this.clients.get(clientId);
    if (c) this.touch(clientId);
    return c;
  }

  // Returns true if (clientId, redirectUri) pair was registered. Used by
  // the /authorize handler so unknown clients with arbitrary redirect_uris
  // don't slip through. Constant-time comparison on the URI to avoid
  // leaking which redirect_uris are registered.
  validateRedirectUri(clientId: string, redirectUri: string): boolean {
    const c = this.clients.get(clientId);
    if (!c) return false;
    const ok = c.redirect_uris.some((r) => constantTimeEq(r, redirectUri));
    if (ok) this.touch(clientId);
    return ok;
  }

  list(): RegisteredClient[] {
    return Array.from(this.clients.values());
  }

  revoke(clientId: string): boolean {
    this.lastUsedAt.delete(clientId);
    return this.clients.delete(clientId);
  }

  count(): number {
    return this.clients.size;
  }
}
