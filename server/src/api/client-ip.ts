// Client IP resolution for the login rate limiter (auth/login-limiter.ts)
// and the OAuth consent password check (api/oauth-flow.ts).
//
// `server.requestIP()` gives the real TCP peer address Bun saw; that's
// trusted on its face. A client-supplied header never is, by default:
// anyone can set X-Forwarded-For or CF-Connecting-IP to anything, so both
// are ignored unless BRAINMD_TRUST_PROXY opts into a specific proxy setup
// *and* the direct peer is one we'd expect that proxy to connect from.
//
// BRAINMD_TRUST_PROXY (unset by default):
//   - "cloudflare": trust the `CF-Connecting-IP` header, but only when the
//     direct peer is loopback. This is the owner's actual deployment: a
//     Cloudflare tunnel (cloudflared.service) runs on the same VPS and
//     forwards to a local port, so the only hop between the tunnel and
//     this process is loopback, and Cloudflare sets CF-Connecting-IP
//     itself at its edge (it strips/overwrites any client-sent copy).
//   - a comma-separated list of IPs: trust X-Forwarded-For, but only when
//     the direct peer is one of those IPs (a known local reverse proxy
//     that appends to the chain rather than trusting it blindly). The
//     resolved address is the right-most entry that isn't itself one of
//     the trusted proxy IPs, since a chain can have more than one trusted
//     hop in front of it.
//
// Elysia's `.handle()` (used by the test harness) has no real socket, so
// `server` is null there; that's the one case where X-Forwarded-For is
// still read directly; there is no real peer address to fall back to and
// no production security boundary at stake.

export interface RequestIpSource {
  requestIP?(request: Request): { address: string } | null;
}

function isLoopback(addr: string): boolean {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function rightmostUntrusted(header: string, trustedProxies: ReadonlySet<string>): string | null {
  const parts = header
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!trustedProxies.has(parts[i]!)) return parts[i]!;
  }
  return null;
}

type TrustProxyConfig =
  | { kind: "none" }
  | { kind: "cloudflare" }
  | { kind: "forwarded"; trustedProxies: ReadonlySet<string> };

function parseTrustProxyEnv(raw: string | undefined): TrustProxyConfig {
  const value = raw?.trim();
  if (!value) return { kind: "none" };
  if (value.toLowerCase() === "cloudflare") return { kind: "cloudflare" };
  const trustedProxies = new Set(
    value
      .split(",")
      .map((ip) => ip.trim())
      .filter((ip) => ip.length > 0),
  );
  return trustedProxies.size > 0 ? { kind: "forwarded", trustedProxies } : { kind: "none" };
}

export function getClientIp(
  request: Request,
  server: RequestIpSource | null | undefined,
  trustProxyEnv: string | undefined = process.env.BRAINMD_TRUST_PROXY,
): string {
  const direct = server?.requestIP?.(request)?.address ?? null;

  // No real socket at all (test harness): same posture as before, read
  // X-Forwarded-For directly since there's no peer address to trust or
  // distrust in the first place.
  if (!server) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const ip = rightmostUntrusted(forwarded, new Set());
      if (ip) return ip;
    }
    return "unknown";
  }

  const trust = parseTrustProxyEnv(trustProxyEnv);
  if (trust.kind === "cloudflare" && direct && isLoopback(direct)) {
    const cf = request.headers.get("cf-connecting-ip")?.trim();
    if (cf) return cf;
  } else if (trust.kind === "forwarded" && direct && trust.trustedProxies.has(direct)) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      const ip = rightmostUntrusted(forwarded, trust.trustedProxies);
      if (ip) return ip;
    }
  }

  // No applicable trust config, or it didn't yield a header value: the
  // direct peer is the only thing we actually verified. For a non-loopback
  // peer that's always been the case; for a loopback peer with no (or no
  // matching) proxy trust configured, this is the safe fallback, one
  // shared bucket for everything arriving through the local tunnel.
  return direct ?? "unknown";
}
