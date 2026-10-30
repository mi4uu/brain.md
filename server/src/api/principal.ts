// Who is making this request, and what are they allowed to touch.
//
// Three kinds of bearer credential can authenticate a request (see
// auth-middleware.ts): a password-login session token, a named API key, or
// an OAuth access token. All three used to be treated identically once they
// passed the bearer check, any of them got full read/write access to every
// folder, on both /api/* and /mcp/*.
//
// That's wrong for the API-key and OAuth cases: those are credentials handed
// to *agents* (MCP clients, scripts, cron jobs), and the per-folder MCP
// permissions (api/folder-perms.ts) plus OAuth scopes exist specifically to
// restrict what an agent can see or change. Only the owner, someone who
// proved they know the password, should bypass folder permissions.
//
// `Principal` is computed once per request in auth-middleware.ts and reused
// by every route (REST and MCP) that touches vault content.
export type Principal =
  | { kind: "owner" } // password-login session token: unrestricted
  | { kind: "apikey" } // named API key: full read/write scope, subject to folder perms
  | { kind: "oauth"; read: boolean; write: boolean } // subject to folder perms AND its own scope
  | { kind: "open" }; // auth.json not configured: back-compat, unrestricted

export function principalCanRead(p: Principal): boolean {
  return p.kind !== "oauth" || p.read;
}

export function principalCanWrite(p: Principal): boolean {
  return p.kind !== "oauth" || p.write;
}

// Owner sessions (and the back-compat "no auth configured" case) bypass
// per-folder MCP permissions on REST, matching the web UI's own full
// access to the vault it's serving.
export function bypassesFolderPerms(p: Principal): boolean {
  return p.kind === "owner" || p.kind === "open";
}

// MCP is always agent traffic, even when auth.json is unconfigured. Before
// the per-folder MCP permissions existed, there was no bypass at all; the
// "open" principal (added for REST back-compat) must not grant MCP clients
// something they never had. Only a proven owner session (password login)
// bypasses folder perms over MCP.
export function bypassesFolderPermsForMcp(p: Principal): boolean {
  return p.kind === "owner";
}

// Endpoints that administer the server itself (folder MCP permissions,
// settings, API keys, the password) require someone who's either proved
// they know the owner's password, or is using the vault with no password
// configured at all (there's nobody else to protect it from in that mode).
// API keys and OAuth tokens, agent credentials, never qualify.
export function isOwnerPrincipal(p: Principal): boolean {
  return p.kind === "owner" || p.kind === "open";
}

export function scopesOf(scope: string): { read: boolean; write: boolean } {
  const parts = scope.split(/\s+/).filter(Boolean);
  return { read: parts.includes("vault:read"), write: parts.includes("vault:write") };
}
