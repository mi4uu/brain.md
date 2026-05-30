import { Elysia, t } from "elysia";
import type { AuthStore } from "../auth/store";
import type { OAuthStore } from "../auth/oauth-store";

// V63 step 2: /oauth/authorize + /oauth/token endpoints.
//
// Authorization-code-with-PKCE flow only (the only grant the MCP spec
// 2025-11-25 actually requires from a server). Same-origin authorization
// server — the user-facing consent page is served by brain.md itself,
// the password from V53 is what gates the "Allow" button.
//
// What we DON'T do here yet (later steps):
//   - /oauth/register (DCR) — step 3. For now, accept any client_id;
//     CIMD support also lands then. Trust comes from the password gate
//     on the consent page, not from prior client registration.

interface AllowedRedirect {
  ok: boolean;
  reason?: string;
}

// Allow http(s)://localhost(:port) and any https://. Rejects http on non-local
// hosts and any URI with fragment (RFC 6749 §3.1.2).
function validateRedirectUri(raw: string): AllowedRedirect {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "redirect_uri is not a valid URL" };
  }
  if (url.hash) return { ok: false, reason: "redirect_uri must not contain a fragment" };
  if (url.protocol === "https:") return { ok: true };
  if (url.protocol === "http:") {
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") {
      return { ok: true };
    }
    return { ok: false, reason: "http redirect_uri is only allowed for localhost" };
  }
  return { ok: false, reason: `unsupported redirect_uri scheme: ${url.protocol}` };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function consentPage(params: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  resource: string;
  error?: string;
}): string {
  const { clientId, redirectUri, scope, state, codeChallenge, resource, error } = params;
  const safe = (s: string) => escapeHtml(s);
  const scopes = scope.split(/\s+/).filter(Boolean);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Authorize · brain.md</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  body { background: #1c1c20; color: #e6e6e6; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 0; min-height: 100vh; display: grid; place-items: center; }
  .card { background: #232328; border: 1px solid #2d2d33; border-radius: 12px; padding: 28px 32px; max-width: 420px; width: calc(100% - 32px); box-shadow: 0 10px 40px rgba(0,0,0,0.4); }
  h1 { margin: 0 0 4px; font-size: 20px; }
  .sub { color: #9b9ba0; font-size: 13px; margin-bottom: 20px; }
  .meta { background: #1c1c20; border: 1px solid #2d2d33; border-radius: 8px; padding: 12px 14px; margin-bottom: 16px; font-size: 13px; }
  .meta dt { color: #9b9ba0; margin-top: 6px; }
  .meta dt:first-child { margin-top: 0; }
  .meta dd { margin: 2px 0 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
  .scopes { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 0; }
  .scope { background: #2d2d33; padding: 3px 8px; border-radius: 4px; font-size: 12px; }
  label { display: block; margin-top: 12px; font-size: 13px; color: #9b9ba0; }
  input[type="password"] { width: 100%; padding: 9px 11px; background: #1c1c20; border: 1px solid #2d2d33; border-radius: 6px; color: #e6e6e6; font-size: 14px; box-sizing: border-box; }
  input[type="password"]:focus { outline: none; border-color: #7c3aed; }
  .actions { display: flex; gap: 10px; margin-top: 20px; }
  button { flex: 1; padding: 10px 14px; border-radius: 6px; border: 1px solid transparent; font-size: 14px; cursor: pointer; font-weight: 500; }
  button.allow { background: #7c3aed; color: white; }
  button.allow:hover { background: #6d28d9; }
  button.deny { background: transparent; border-color: #2d2d33; color: #9b9ba0; }
  button.deny:hover { border-color: #4d4d53; color: #e6e6e6; }
  .error { background: #3d1d1d; border: 1px solid #6d2d2d; color: #f9b8b8; padding: 9px 12px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
</style>
</head>
<body>
  <div class="card">
    <h1>Authorize access to your vault</h1>
    <div class="sub">An MCP client wants to connect to brain.md.</div>
    ${error ? `<div class="error">${safe(error)}</div>` : ""}
    <div class="meta">
      <dl>
        <dt>Client</dt><dd>${safe(clientId)}</dd>
        <dt>Redirect to</dt><dd>${safe(redirectUri)}</dd>
        <dt>Resource</dt><dd>${safe(resource)}</dd>
        <dt>Scopes requested</dt>
        <dd><div class="scopes">${scopes.map((s) => `<span class="scope">${safe(s)}</span>`).join("")}</div></dd>
      </dl>
    </div>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="client_id" value="${safe(clientId)}" />
      <input type="hidden" name="redirect_uri" value="${safe(redirectUri)}" />
      <input type="hidden" name="scope" value="${safe(scope)}" />
      <input type="hidden" name="state" value="${safe(state)}" />
      <input type="hidden" name="code_challenge" value="${safe(codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="S256" />
      <input type="hidden" name="resource" value="${safe(resource)}" />
      <label for="password">Vault password</label>
      <input type="password" id="password" name="password" autocomplete="current-password" autofocus required />
      <div class="actions">
        <button type="submit" name="decision" value="deny" class="deny">Deny</button>
        <button type="submit" name="decision" value="allow" class="allow">Allow</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

function redirectWithError(redirectUri: string, state: string, error: string, description?: string): Response {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (description) u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: u.toString() } });
}

const SUPPORTED_SCOPES = new Set(["vault:read", "vault:write"]);

export function oauthFlowRoutes(authStore: AuthStore, oauth: OAuthStore) {
  return (
    new Elysia()

      // ----- GET /oauth/authorize (render consent) -----
      .get(
        "/oauth/authorize",
        ({ query, set }) => {
          const responseType = String(query.response_type ?? "");
          const clientId = String(query.client_id ?? "");
          const redirectUri = String(query.redirect_uri ?? "");
          const scope = String(query.scope ?? "vault:read vault:write");
          const state = String(query.state ?? "");
          const codeChallenge = String(query.code_challenge ?? "");
          const codeChallengeMethod = String(query.code_challenge_method ?? "");
          const resource = String(query.resource ?? "");

          // Validate the parameters that don't depend on the user.
          // Per OAuth 2.1 §5.1.1: errors that prevent us from trusting the
          // redirect_uri (missing client_id, bad redirect_uri) are returned
          // to the user agent directly — NOT redirected. Errors after we've
          // validated redirect_uri get redirected with error code.

          if (!clientId) {
            set.status = 400;
            return { error: "invalid_request", error_description: "client_id required" };
          }
          if (!redirectUri) {
            set.status = 400;
            return { error: "invalid_request", error_description: "redirect_uri required" };
          }
          const redirOk = validateRedirectUri(redirectUri);
          if (!redirOk.ok) {
            set.status = 400;
            return { error: "invalid_request", error_description: redirOk.reason };
          }

          // From here on, errors redirect.
          if (responseType !== "code") {
            return redirectWithError(redirectUri, state, "unsupported_response_type", "only 'code' is supported");
          }
          if (!codeChallenge) {
            return redirectWithError(redirectUri, state, "invalid_request", "code_challenge required (PKCE)");
          }
          if (codeChallengeMethod !== "S256") {
            return redirectWithError(redirectUri, state, "invalid_request", "code_challenge_method must be S256");
          }
          if (!resource) {
            return redirectWithError(redirectUri, state, "invalid_request", "resource parameter required (RFC 8707)");
          }
          // Reject scopes outside the advertised set (V64 scopes_supported).
          const requested = scope.split(/\s+/).filter(Boolean);
          const unknown = requested.find((s) => !SUPPORTED_SCOPES.has(s));
          if (unknown) {
            return redirectWithError(redirectUri, state, "invalid_scope", `unknown scope: ${unknown}`);
          }

          // If no vault password is configured, refuse to issue tokens. We
          // can't prove the consenting agent is the vault owner without
          // some shared secret.
          if (!authStore.isConfigured()) {
            set.status = 503;
            return {
              error: "server_error",
              error_description:
                "OAuth requires a vault password. Open Settings → Security and set one before connecting MCP clients.",
            };
          }

          set.headers["content-type"] = "text/html; charset=utf-8";
          return consentPage({
            clientId,
            redirectUri,
            scope: requested.join(" "),
            state,
            codeChallenge,
            resource,
          });
        },
      )

      // ----- POST /oauth/authorize (consent submission) -----
      .post(
        "/oauth/authorize",
        async ({ body, set }) => {
          const b = body as Record<string, string>;
          const decision = String(b.decision ?? "");
          const clientId = String(b.client_id ?? "");
          const redirectUri = String(b.redirect_uri ?? "");
          const scope = String(b.scope ?? "");
          const state = String(b.state ?? "");
          const codeChallenge = String(b.code_challenge ?? "");
          const resource = String(b.resource ?? "");
          const password = String(b.password ?? "");

          const redirOk = validateRedirectUri(redirectUri);
          if (!redirOk.ok) {
            set.status = 400;
            return { error: "invalid_request", error_description: redirOk.reason };
          }

          if (decision === "deny") {
            return redirectWithError(redirectUri, state, "access_denied", "user denied");
          }

          // Verify password against V53 hash.
          const hash = authStore.getHash();
          if (!hash) {
            return redirectWithError(redirectUri, state, "server_error", "vault password missing");
          }
          const ok = await Bun.password.verify(password, hash);
          if (!ok) {
            set.headers["content-type"] = "text/html; charset=utf-8";
            return consentPage({
              clientId, redirectUri, scope, state, codeChallenge, resource,
              error: "Incorrect password. Try again.",
            });
          }

          const code = oauth.issueCode({
            clientId,
            redirectUri,
            scope,
            codeChallenge,
            codeChallengeMethod: "S256",
            resource,
          });

          const u = new URL(redirectUri);
          u.searchParams.set("code", code);
          if (state) u.searchParams.set("state", state);
          return new Response(null, { status: 302, headers: { location: u.toString() } });
        },
        {
          // Accept form-urlencoded only — the consent <form> uses POST with
          // the default enctype.
          parse: "urlencoded",
        },
      )

      // ----- POST /oauth/token -----
      .post(
        "/oauth/token",
        ({ body, set }) => {
          const b = body as Record<string, string>;
          const grantType = String(b.grant_type ?? "");
          set.headers["cache-control"] = "no-store";
          set.headers["pragma"] = "no-cache";

          if (grantType === "authorization_code") {
            const code = String(b.code ?? "");
            const codeVerifier = String(b.code_verifier ?? "");
            const clientId = String(b.client_id ?? "");
            const redirectUri = String(b.redirect_uri ?? "");
            const resource = String(b.resource ?? "");
            if (!code || !codeVerifier || !clientId || !redirectUri || !resource) {
              set.status = 400;
              return { error: "invalid_request", error_description: "missing required parameter" };
            }
            const consumed = oauth.consumeCode(code, { clientId, redirectUri, codeVerifier, resource });
            if (!consumed.ok) {
              set.status = 400;
              return { error: consumed.error, error_description: consumed.reason };
            }
            const pair = oauth.issueTokenPair({
              clientId,
              scope: consumed.scope,
              resource: consumed.resource,
            });
            return {
              access_token: pair.accessToken,
              token_type: "Bearer",
              expires_in: pair.expiresIn,
              refresh_token: pair.refreshToken,
              scope: pair.scope,
            };
          }

          if (grantType === "refresh_token") {
            const refreshToken = String(b.refresh_token ?? "");
            const clientId = String(b.client_id ?? "");
            if (!refreshToken || !clientId) {
              set.status = 400;
              return { error: "invalid_request", error_description: "refresh_token and client_id required" };
            }
            const refreshed = oauth.refreshTokenPair({ refreshToken, clientId });
            if (!refreshed.ok) {
              set.status = 400;
              return { error: refreshed.error, error_description: refreshed.reason };
            }
            return {
              access_token: refreshed.pair.accessToken,
              token_type: "Bearer",
              expires_in: refreshed.pair.expiresIn,
              refresh_token: refreshed.pair.refreshToken,
              scope: refreshed.pair.scope,
            };
          }

          set.status = 400;
          return { error: "unsupported_grant_type", error_description: `grant_type '${grantType}' not supported` };
        },
        {
          parse: "urlencoded",
        },
      )
  );
}
