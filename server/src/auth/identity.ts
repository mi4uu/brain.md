import { AsyncLocalStorage } from "node:async_hooks";

// board-plan Part B / P2: who made a change, threaded through the request
// without passing it down every call site. auth-middleware.ts resolves an
// Identity once per request (after the bearer check) and enters it here.
// Anything downstream, including vault.onMutation listeners, which never
// see the Request object, reads it back with currentIdentity().
//
// kind stays coarse on purpose: "human" is the single owner (password
// login or the back-compat unauthenticated case), "apikey" and
// "oauth-client" are agent credentials. OAuth *login* (a real per-user
// human identity) is a later step; today every kind still traces back to
// the one vault owner, sub just tells the credentials apart.
export type IdentityKind = "human" | "apikey" | "oauth-client";

export interface Identity {
  sub: string;
  name: string;
  email?: string;
  kind: IdentityKind;
  // Set for non-human kinds: the API key's or OAuth client's own name, used
  // for the git "Agent:" trailer. Mirrors `name` today (no separate human
  // name exists yet) but kept distinct for when OAuth login adds one.
  clientName?: string;
  // Stable grouping key for autocommit.ts's one-commit-per-actor split.
  // Defaults to `sub`, which is unique per API key but NOT per OAuth
  // client: every MCP client whose consent was granted with the vault
  // password (rather than a per-user session) gets the same `sub`
  // (LOCAL_SUB), the subject is "the owner", not "which client". Without
  // a separate grouping key, two different password-consented MCP
  // clients collapse into one commit, crediting whichever client's
  // identity happened to be recorded first for that subject.
  credentialId?: string;
}

// Credential records predating this change have no `sub` of their own,
// they were all indistinguishable from the single owner. Every store's
// migration defaults a missing sub to this value.
export const LOCAL_SUB = "local";

export const identityContext = new AsyncLocalStorage<Identity>();

export function currentIdentity(): Identity | undefined {
  return identityContext.getStore();
}

export function localIdentity(ownerName: string, ownerEmail: string, sub: string = LOCAL_SUB): Identity {
  return { sub, name: ownerName, email: ownerEmail, kind: "human" };
}

// OIDC/GitHub login (board-plan Part B): still the vault owner's single
// identity for permission purposes, but the git "Author:" line should say
// who actually clicked allow, not the owner config fallback that
// localIdentity() uses for the password-login case.
export function externalIdentity(sub: string, name: string, email: string): Identity {
  return { sub, name, email, kind: "human" };
}

// `keyId`: the API key's own stable id (APIKey.id), used as the
// autocommit grouping key. Migrated legacy keys all share sub ===
// LOCAL_SUB (they predate per-key subs), so without this two unrelated
// legacy keys would collapse into one commit, credited to whichever
// key's identity autocommit happened to record first for that subject.
export function apiKeyIdentity(sub: string, keyName: string, keyId?: string): Identity {
  return {
    sub,
    name: keyName,
    kind: "apikey",
    clientName: keyName,
    credentialId: keyId ? `apikey:${keyId}` : undefined,
  };
}

export function oauthClientIdentity(sub: string, clientName: string, clientId?: string): Identity {
  return {
    sub,
    name: clientName,
    kind: "oauth-client",
    clientName,
    credentialId: clientId ? `oauth-client:${clientId}` : sub,
  };
}
