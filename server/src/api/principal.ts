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
// per-folder MCP permissions entirely. Everyone else is subject to them.
export function bypassesFolderPerms(p: Principal): boolean {
  return p.kind === "owner" || p.kind === "open";
}

export function scopesOf(scope: string): { read: boolean; write: boolean } {
  const parts = scope.split(/\s+/).filter(Boolean);
  return { read: parts.includes("vault:read"), write: parts.includes("vault:write") };
}
