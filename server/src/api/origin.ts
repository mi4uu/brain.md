// Shared by auth-middleware.ts and oauth-discovery.ts (previously two
// copies of the same function, with the same comment, that had to be
// kept in sync by hand). Both need the exact origin the caller actually
// used, honouring proxy/tunnel headers, for the same reason: an OAuth
// resource/audience URI, or a WWW-Authenticate challenge, must match the
// hostname+scheme the client connected with or the client rejects it.
//
// Priority:
//   1. Cloudflare `cf-visitor` JSON (`{"scheme":"https"}`) — set by
//      Cloudflare Tunnel, which does NOT populate x-forwarded-proto.
//      Without this, URLs are advertised as http:// even though the
//      client connected over https, a spec violation some clients
//      refuse outright.
//   2. Standard x-forwarded-{proto,host}.
//   3. Fallback to the request URL, but force HTTPS for any non-
//      localhost host (assume a reverse proxy terminates TLS).
export function originOf(req: Request): string {
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    new URL(req.url).host;

  let proto: string | undefined;
  const cfVisitor = req.headers.get("cf-visitor");
  if (cfVisitor) {
    try {
      const v = JSON.parse(cfVisitor) as { scheme?: string };
      if (v.scheme === "http" || v.scheme === "https") proto = v.scheme;
    } catch {
      // ignore malformed
    }
  }
  if (!proto) proto = req.headers.get("x-forwarded-proto") ?? undefined;
  if (!proto) {
    const u = new URL(req.url);
    proto = u.protocol.replace(":", "");
  }
  const isLocal =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");
  if (!isLocal && proto === "http") proto = "https";
  return `${proto}://${host}`;
}
