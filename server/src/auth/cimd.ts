import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

// V67: OAuth Client ID Metadata Documents (CIMD,
// draft-ietf-oauth-client-id-metadata-document-00). Used by Claude.ai,
// ChatGPT Apps, and any spec-compliant MCP client that doesn't want to
// pre-register: the `client_id` value is itself an HTTPS URL that
// resolves to a JSON document describing the client. We fetch that
// document at /oauth/authorize time, validate it, and use the metadata
// (especially `redirect_uris`) instead of a DCR-style registration.
//
// Security: the AS makes an HTTP request based on attacker-controlled
// input. SSRF defence is mandatory — see check-list in §V67 below.

export interface ClientMetadata {
  client_id: string;
  client_name: string;
  client_uri?: string;
  logo_uri?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
}

interface CacheEntry {
  metadata: ClientMetadata;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000;       // 1h, ignoring HTTP cache headers for now
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 64 * 1024;       // metadata docs are tiny — 64KB is generous

// IPv4 private / loopback / link-local / "this network".
export function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as untrusted
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF protocol assignments (incl. NAT64 well-known prefix)
  if (a === 192 && b === 88 && c === 99) return true; // 192.88.99.0/24 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

// IPv6 loopback (::1), link-local (fe80::/10), unique-local (fc00::/7),
// and v4-mapped (::ffff:0:0/96) we punt to the v4 check.
function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    return isPrivateV4(v4);
  }
  return false;
}

interface SafeURL {
  url: URL;
  // Every address the hostname resolved to, already checked against the
  // private/loopback blocklist. The caller connects to one of these
  // directly instead of letting fetch() re-resolve the hostname, that
  // second resolution is the DNS-rebinding TOCTOU window (V67 follow-up).
  addresses: Array<{ address: string; family: number }>;
}

async function assertSafeURL(url: string): Promise<SafeURL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid client_id URL: ${url}`);
  }
  if (u.protocol !== "https:") {
    throw new Error(`client_id URL must use https://, got ${u.protocol}`);
  }
  if (!u.hostname) {
    throw new Error("client_id URL missing hostname");
  }
  // Resolve hostname to IP. If it resolves to a private range, reject —
  // this is the SSRF gate the spec warns about (Section 6 of CIMD draft).
  let addrs;
  try {
    addrs = await dnsLookup(u.hostname, { all: true });
  } catch {
    throw new Error(`client_id URL host did not resolve: ${u.hostname}`);
  }
  if (addrs.length === 0) {
    throw new Error(`client_id URL host did not resolve: ${u.hostname}`);
  }
  for (const a of addrs) {
    const blocked = a.family === 4 ? isPrivateV4(a.address) : isPrivateV6(a.address);
    if (blocked) {
      throw new Error(
        `client_id URL host ${u.hostname} resolves to a private/loopback address (${a.address}) — refusing to fetch`,
      );
    }
  }
  return { url: u, addresses: addrs };
}

export function validateMetadata(raw: unknown, expectedClientId: string): ClientMetadata {
  if (!raw || typeof raw !== "object") {
    throw new Error("metadata is not a JSON object");
  }
  const m = raw as Record<string, unknown>;
  if (typeof m.client_id !== "string" || m.client_id !== expectedClientId) {
    throw new Error("metadata.client_id MUST equal the document URL exactly");
  }
  if (typeof m.client_name !== "string" || m.client_name.length === 0) {
    throw new Error("metadata.client_name required");
  }
  if (!Array.isArray(m.redirect_uris) || m.redirect_uris.length === 0) {
    throw new Error("metadata.redirect_uris must be a non-empty array");
  }
  for (const u of m.redirect_uris) {
    if (typeof u !== "string") throw new Error("redirect_uris must contain strings");
    let parsed: URL;
    try {
      parsed = new URL(u);
    } catch {
      throw new Error(`redirect_uri is not a valid URL: ${u}`);
    }
    if (parsed.hash) throw new Error(`redirect_uri must not contain a fragment: ${u}`);
    if (parsed.protocol === "https:") continue;
    if (parsed.protocol === "http:") {
      const h = parsed.hostname;
      if (h === "localhost" || h === "127.0.0.1" || h === "[::1]") continue;
      throw new Error(`http redirect_uri only allowed for localhost: ${u}`);
    }
    throw new Error(`unsupported redirect_uri scheme: ${parsed.protocol}`);
  }
  // Ignore grant_types we don't support (e.g. jwt-bearer from Claude.ai)
  // rather than rejecting the whole client. We only require that the client
  // can use authorization_code — that's the flow we run. Extra grants the AS
  // doesn't implement are simply dropped, per CIMD/OAuth guidance.
  const declaredGrants = Array.isArray(m.grant_types) ? m.grant_types : ["authorization_code"];
  const grants = declaredGrants.filter((g) => g === "authorization_code" || g === "refresh_token");
  if (!grants.includes("authorization_code")) {
    throw new Error("client must support authorization_code grant");
  }
  const responses = Array.isArray(m.response_types) ? m.response_types : ["code"];
  for (const r of responses) {
    if (r !== "code") throw new Error(`response_type not supported: ${String(r)}`);
  }
  const auth = typeof m.token_endpoint_auth_method === "string"
    ? m.token_endpoint_auth_method
    : "none";
  if (auth !== "none") {
    throw new Error("token_endpoint_auth_method must be 'none' (PKCE-only public clients)");
  }
  return {
    client_id: m.client_id,
    client_name: m.client_name.slice(0, 200),
    client_uri: typeof m.client_uri === "string" ? m.client_uri : undefined,
    logo_uri: typeof m.logo_uri === "string" ? m.logo_uri : undefined,
    redirect_uris: m.redirect_uris as string[],
    grant_types: grants,
    response_types: responses,
    token_endpoint_auth_method: "none",
  };
}

// Fetches the metadata document over a connection pinned to one of the
// addresses `assertSafeURL` already validated. We use node:https directly
// (rather than fetch()) because fetch would re-resolve the hostname itself
// right before connecting, the classic DNS-rebinding TOCTOU: the name
// could point at a public IP during our check and a private one moments
// later. Pinning the socket to the validated address closes that window
// while `servername` keeps TLS hostname verification against the real
// client_id hostname, so a forged/mismatched cert is still rejected.
function fetchWithLimit(safe: SafeURL): Promise<unknown> {
  const { url, addresses } = safe;
  const pinned = addresses[0];
  if (!pinned) throw new Error("client_id URL host did not resolve");
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpsRequest(
      {
        host: pinned.address,
        port: url.port ? Number(url.port) : 443,
        path: url.pathname + url.search,
        method: "GET",
        servername: url.hostname, // SNI + cert hostname check stay on the real name
        headers: { accept: "application/json", host: url.hostname },
        timeout: FETCH_TIMEOUT_MS,
        // Never follow redirects, a redirect target would need its own
        // SSRF check, and the CIMD draft doesn't require following them.
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          rejectPromise(new Error(`refusing to follow redirect from client_id URL (status ${status})`));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          rejectPromise(new Error(`client_id URL returned HTTP ${status}`));
          return;
        }
        let total = 0;
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > MAX_RESPONSE_BYTES) {
            req.destroy();
            rejectPromise(new Error(`client_id URL response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (e) {
            rejectPromise(e instanceof Error ? e : new Error(String(e)));
          }
        });
        res.on("error", rejectPromise);
      },
    );
    req.on("timeout", () => req.destroy(new Error("client_id URL request timed out")));
    req.on("error", rejectPromise);
    req.end();
  });
}

export class CimdResolver {
  private readonly cache = new Map<string, CacheEntry>();

  async resolve(clientIdUrl: string): Promise<ClientMetadata> {
    const cached = this.cache.get(clientIdUrl);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }
    const safe = await assertSafeURL(clientIdUrl);
    const raw = await fetchWithLimit(safe);
    const metadata = validateMetadata(raw, clientIdUrl);
    this.cache.set(clientIdUrl, {
      metadata,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return metadata;
  }

  invalidate(clientIdUrl: string): void {
    this.cache.delete(clientIdUrl);
  }
}

export function isCimdClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}
