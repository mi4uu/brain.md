import { lookup as dnsLookup } from "node:dns/promises";

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
function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as untrusted
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
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

async function assertSafeURL(url: string): Promise<URL> {
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
  for (const a of addrs) {
    const blocked = a.family === 4 ? isPrivateV4(a.address) : isPrivateV6(a.address);
    if (blocked) {
      throw new Error(
        `client_id URL host ${u.hostname} resolves to a private/loopback address (${a.address}) — refusing to fetch`,
      );
    }
  }
  return u;
}

function validateMetadata(raw: unknown, expectedClientId: string): ClientMetadata {
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
  const grants = Array.isArray(m.grant_types) ? m.grant_types : ["authorization_code"];
  for (const g of grants) {
    if (g !== "authorization_code" && g !== "refresh_token") {
      throw new Error(`grant_type not supported: ${String(g)}`);
    }
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

async function fetchWithLimit(url: URL): Promise<unknown> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: ac.signal,
      // Don't follow redirects across hosts — that would re-open the SSRF
      // window after we DNS-checked the original. `manual` returns a
      // Response with status 0/3xx; we just refuse on any redirect.
      redirect: "manual",
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`refusing to follow redirect from client_id URL (status ${res.status})`);
    }
    if (!res.ok) {
      throw new Error(`client_id URL returned HTTP ${res.status}`);
    }
    const reader = res.body?.getReader();
    if (!reader) throw new Error("client_id URL response had no body");
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          throw new Error(`client_id URL response exceeded ${MAX_RESPONSE_BYTES} bytes`);
        }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    const text = new TextDecoder("utf-8").decode(buf);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
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
