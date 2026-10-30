import { Elysia } from "elysia";

// DNS-rebinding guard. Only matters while no password is set: then
// auth-middleware lets every /api and /mcp request through, and a page on
// any site can rebind its own hostname to this machine and call us
// same-origin. With a password set every request needs a bearer token the
// rebinding page does not have, and there are no cookies to ride on, so
// the checks are skipped and proxy/tunnel/LAN setups keep working.
//
// Every Host-like header the request carries must be allowed. A rebinding
// page can add its own X-Forwarded-Host, but it cannot change Host, so
// requiring both closes that path while still covering proxies that rewrite
// Host to an internal name and pass the public one in X-Forwarded-Host.
//
// ALLOWED_HOSTS (config/index.ts) seeds the list with loopback names plus
// any extra hostnames for passwordless access through a proxy or the LAN.

// Shared with app.ts's CORS config: both need "is this hostname one we
// trust" with the same loopback + ALLOWED_HOSTS rules.
export function buildAllowedHostsSet(allowedHosts: string[]): Set<string> {
  return new Set(allowedHosts.map((h) => h.toLowerCase()));
}

export function isAllowedOriginHost(origin: string, allowed: Set<string>): boolean {
  try {
    return allowed.has(hostnameOf(new URL(origin).host));
  } catch {
    return false;
  }
}

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    // IPv6 literal, e.g. "[::1]:3000": keep the bracketed form so it
    // matches the "[::1]" entry in the allowlist.
    const end = h.indexOf("]");
    return end >= 0 ? h.slice(0, end + 1) : h;
  }
  const colon = h.lastIndexOf(":");
  return colon >= 0 ? h.slice(0, colon) : h;
}

export function hostMiddleware(
  allowedHosts: string[],
  auth: { isConfigured(): boolean },
) {
  const allowed = buildAllowedHostsSet(allowedHosts);
  return new Elysia().onRequest(({ request, set }) => {
    if (auth.isConfigured()) return;

    const hosts = [request.headers.get("host") ?? new URL(request.url).host];
    const forwarded = request.headers.get("x-forwarded-host");
    if (forwarded) hosts.push(forwarded);
    if (!hosts.every((h) => allowed.has(hostnameOf(h)))) {
      set.status = 400;
      return new Response(
        JSON.stringify({
          error: "invalid host: set a password or add this hostname to ALLOWED_HOSTS",
          code: "HOST_NOT_ALLOWED",
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    // Validate Origin whenever it's sent, not just on writes: with no
    // password configured, a GET also returns real content, and a page
    // on an untrusted origin can rebind its own hostname to reach us
    // same-origin, then issue a cross-origin read with an attacker Origin
    // header. curl, MCP and CLI clients usually send no Origin at all.
    const origin = request.headers.get("origin");
    if (origin && !isAllowedOriginHost(origin, allowed)) {
      set.status = 403;
      return new Response(
        JSON.stringify({ error: "invalid origin", code: "ORIGIN_NOT_ALLOWED" }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
  });
}
