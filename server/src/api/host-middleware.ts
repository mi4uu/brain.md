import { Elysia } from "elysia";

// Without a password set, auth-middleware is a no-op — every /api and
// /mcp endpoint is open. That's fine for "only I can reach my own
// machine", but a browser on any site can be made to send a request to
// http://localhost:3000/... (or to this machine's LAN IP) and, via DNS
// rebinding, to a hostname that resolves to this machine too. Browsers
// don't restrict cross-origin fetches to a server that doesn't send CORS
// headers back for *reading* the response, but plenty of damage (writes)
// doesn't need the response to be readable — the request going through is
// enough. A Host allowlist closes that: if the Host header isn't one we
// recognise as "actually us", refuse before touching auth or any route.
//
// ALLOWED_HOSTS (config/index.ts) seeds this with loopback names plus
// whatever extra hostnames the deployment's reverse proxy or tunnel
// forwards as Host (e.g. a Cloudflare Tunnel hostname).

function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) {
    // IPv6 literal, e.g. "[::1]:3000" — keep the bracketed form so it
    // matches the "[::1]" entry in the allowlist.
    const end = h.indexOf("]");
    return end >= 0 ? h.slice(0, end + 1) : h;
  }
  const colon = h.lastIndexOf(":");
  return colon >= 0 ? h.slice(0, colon) : h;
}

export function hostMiddleware(allowedHosts: string[]) {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return new Elysia().onRequest(({ request, set }) => {
    // Mirrors auth-middleware's originOf(): some reverse proxies forward
    // the public hostname via x-forwarded-host and rewrite Host to an
    // internal one, so check that first. request.url's host is the last
    // resort — Bun fills it in from the connection's actual Host header,
    // so this still reflects what the client sent even when neither
    // header is present as a distinct Headers entry.
    const hostHeader =
      request.headers.get("x-forwarded-host") ??
      request.headers.get("host") ??
      new URL(request.url).host;
    if (!allowed.has(hostnameOf(hostHeader))) {
      set.status = 400;
      return new Response(
        JSON.stringify({ error: "invalid host", code: "HOST_NOT_ALLOWED" }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    // Origin check on state-changing requests — a bare Host match isn't
    // enough once the request carries a browser Origin, since that's the
    // header a rebinding attack actually controls from script. Only
    // enforced when Origin is present; curl/MCP/CLI clients usually don't
    // send one, and GET/HEAD/OPTIONS are left alone (navigations, CORS
    // preflight, and plain reads that already need a valid Host).
    const method = request.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = request.headers.get("origin");
      if (origin) {
        let originHost: string | undefined;
        try {
          originHost = hostnameOf(new URL(origin).host);
        } catch {
          originHost = undefined;
        }
        if (!originHost || !allowed.has(originHost)) {
          set.status = 403;
          return new Response(
            JSON.stringify({ error: "invalid origin", code: "ORIGIN_NOT_ALLOWED" }),
            { status: 403, headers: { "content-type": "application/json" } },
          );
        }
      }
    }
  });
}
