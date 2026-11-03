import { Elysia } from "elysia";

// Headers that belong on every response, not just HTML pages (unlike CSP,
// which only makes sense for documents a browser renders — see web/serve.ts
// and api/oauth-flow.ts for that one).
//
// Set in onRequest rather than onAfterHandle: a few middlewares further
// down the chain (host-middleware's DNS-rebinding guard) short-circuit by
// returning their own `new Response(...)` straight from onRequest, which
// skips onAfterHandle/mapResponse entirely. `set.headers` mutated earlier
// in the chain still gets merged into that response, so this has to run
// before anything that might short-circuit.
export function applySecurityHeaders(set: { headers: Record<string, string | number> }): void {
  set.headers["x-content-type-options"] = "nosniff";
  set.headers["referrer-policy"] = "strict-origin-when-cross-origin";
}

export function securityHeadersMiddleware() {
  return new Elysia().onRequest(({ set }) => {
    applySecurityHeaders(set);
  });
}
