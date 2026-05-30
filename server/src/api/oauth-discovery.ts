import { Elysia } from "elysia";

// V64: OAuth 2.1 discovery surface for MCP authorization spec 2025-11-25.
//
// Two well-known JSON documents let an MCP client discover where this
// server's authorization endpoints live without any pre-configuration:
//
//   GET /.well-known/oauth-protected-resource   (RFC 9728)
//     → resource URI + advertised authorization_servers + scopes_supported
//
//   GET /.well-known/oauth-authorization-server (RFC 8414)
//     → issuer + authorization_endpoint + token_endpoint + registration_endpoint
//       + code_challenge_methods_supported: ["S256"] (PKCE mandatory)
//
// We embed the AS in the same origin as the MCP server (same Elysia app)
// to keep the local-first single-binary deployment model intact. The
// `/oauth/{authorize,token,register}` endpoints themselves arrive in
// later commits — this file only advertises them.

const SUPPORTED_SCOPES = ["vault:read", "vault:write"] as const;

function originOf(req: Request): string {
  // Honour proxy / tunnel headers so the advertised URLs match the
  // hostname the client actually used. Cloudflare Tunnel and most
  // reverse proxies set x-forwarded-{proto,host}; fall back to the
  // request URL when not present (direct local hits).
  const fwdProto = req.headers.get("x-forwarded-proto");
  const fwdHost = req.headers.get("x-forwarded-host");
  if (fwdProto && fwdHost) return `${fwdProto}://${fwdHost}`;
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

export function oauthDiscoveryRoutes() {
  return new Elysia()
    .get("/.well-known/oauth-protected-resource", ({ request }) => {
      const origin = originOf(request);
      return {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: SUPPORTED_SCOPES,
        bearer_methods_supported: ["header"],
        resource_documentation: "https://github.com/mi4uu/brain.md#-mcp-server",
      };
    })
    .get("/.well-known/oauth-authorization-server", ({ request }) => {
      const origin = originOf(request);
      return {
        issuer: origin,
        authorization_endpoint: `${origin}/oauth/authorize`,
        token_endpoint: `${origin}/oauth/token`,
        registration_endpoint: `${origin}/oauth/register`,
        scopes_supported: SUPPORTED_SCOPES,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        client_id_metadata_document_supported: true,
        service_documentation: "https://github.com/mi4uu/brain.md#-mcp-server",
      };
    });
}
