// Client IP resolution for the login rate limiter (api/login-limiter.ts).
//
// Mirrors host-middleware's stance on forwarded headers: never trust one
// blindly. `server.requestIP()` gives the real TCP peer address Bun saw;
// that's trusted on its face. X-Forwarded-For is only trusted when the
// direct peer is loopback, i.e. the request arrived through a local
// reverse proxy (cloudflared tunnel, nginx on the same box) rather than
// straight off the internet — a non-loopback peer can set that header to
// anything, so it's ignored in that case. Same test harness quirk as
// host-middleware: Elysia's `.handle()` has no real socket, so `server`
// is null and callers fall into the same branch as a loopback peer.

export interface RequestIpSource {
  requestIP?(request: Request): { address: string } | null;
}

function isLoopback(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function firstForwardedIp(header: string): string | null {
  const first = header.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export function getClientIp(
  request: Request,
  server: RequestIpSource | null | undefined,
): string {
  const direct = server?.requestIP?.(request)?.address ?? null;
  if (direct && !isLoopback(direct)) return direct;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ip = firstForwardedIp(forwarded);
    if (ip) return ip;
  }
  return direct ?? "unknown";
}
