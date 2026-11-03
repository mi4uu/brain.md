// Client IP resolution for the login rate limiter (api/login-limiter.ts).
//
// Mirrors host-middleware's stance on forwarded headers: never trust one
// blindly. `server.requestIP()` gives the real TCP peer address Bun saw;
// that's trusted on its face. X-Forwarded-For is only trusted when the
// direct peer is loopback, i.e. the request arrived through a local
// reverse proxy (cloudflared tunnel, nginx on the same box) rather than
// straight off the internet: a non-loopback peer can set that header to
// anything, so it's ignored in that case. Same test harness quirk as
// host-middleware: Elysia's `.handle()` has no real socket, so `server`
// is null and callers fall into the same branch as a loopback peer.

export interface RequestIpSource {
  requestIP?(request: Request): { address: string } | null;
}

function isLoopback(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

// The trusted local proxy appends the address it saw the request arrive
// from to the END of whatever X-Forwarded-For chain it received, it never
// edits what's already there. So the rightmost entry is the one our one
// trusted hop actually vouches for; anything to its left came from
// whoever made the request and is exactly as trustworthy as a
// self-reported header, i.e. not at all. Taking the leftmost entry
// (the "original client" by convention) let an attacker pick any
// rate-limit key it wanted by prefixing the header with junk, while the
// real peer address the proxy appended stayed constant.
function lastForwardedIp(header: string): string | null {
  const parts = header.split(",");
  const last = parts[parts.length - 1]?.trim();
  return last && last.length > 0 ? last : null;
}

export function getClientIp(
  request: Request,
  server: RequestIpSource | null | undefined,
): string {
  const direct = server?.requestIP?.(request)?.address ?? null;
  if (direct && !isLoopback(direct)) return direct;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = lastForwardedIp(forwarded);
    if (ip) return ip;
  }
  return direct ?? "unknown";
}
