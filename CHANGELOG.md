# Changelog

## 0.5.0 - 2026-11-05

Optional OIDC/GitHub login, next to the existing password login. Password
login and passwordless (no auth configured) installs are unaffected unless
you opt in.

### Added

- External login providers (board-plan Part B): generic OIDC and GitHub,
  selected and configured through environment variables:
  - `BRAINMD_OIDC_ISSUER`, `BRAINMD_OIDC_CLIENT_ID`, `BRAINMD_OIDC_CLIENT_SECRET`
    (all three required together), plus optional `BRAINMD_OIDC_NAME`,
    `BRAINMD_OIDC_SCOPES`, `BRAINMD_OIDC_GROUPS_CLAIM`,
    `BRAINMD_OIDC_ALLOWED_GROUPS`.
  - `BRAINMD_GITHUB_CLIENT_ID`, `BRAINMD_GITHUB_CLIENT_SECRET` (both required
    together).
  - `BRAINMD_PUBLIC_URL`: required once either provider above is configured,
    used to build the OAuth redirect URI. Must be `https://` except for
    localhost/127.0.0.1 development.
  - `BRAINMD_OAUTH_ALLOWED_EMAILS`, `BRAINMD_OAUTH_ALLOWED_DOMAINS`: at least
    one allowlist (these, or an OIDC groups claim + allowed groups) is
    required whenever an external provider is configured. **The server
    refuses to start otherwise** (fail closed, not fail open).
- Per-folder permissions, enforced server-side and failing closed on a
  missing or corrupt `folder-meta.json`.
- `__Host-` prefixed session cookies.
- A path-level git attribution audit trail: autocommit records which
  identity (owner, API key, OAuth client, or external login subject)
  touched which path, via `Changed-by` / `On-Behalf-Of` / `Agent` trailers
  on commits that span more than one actor in a single flush.

### Security

- Bumped `@modelcontextprotocol/sdk` 1.29.0 → ^1.32.2 and `elysia` 1.1.25 →
  ^1.4.31 (plus the matching `@elysiajs/cors` peer range): the SDK carried
  several high-severity advisories (OAuth redirect confusion, unbounded
  JSON-RPC batch memory exhaustion, bearer-token audience confusion,
  cross-origin redirect leak; GHSA-6qxp-vccf-f47h, GHSA-22jm-h49p-29qw,
  GHSA-46jr-4wx8-v453, GHSA-rvq5-wwqv-78pq, GHSA-f897-62hf-6gxq), and elysia
  carried a high-severity algorithmic-complexity DoS reachable from
  pre-auth routes.
- Bumped `zod` 3.25.0 → ^4.6.7 (GHSA-mrhx-c7xc-m3w5, unbounded
  memory-exhaustion DoS with no stable 3.x backport), with a root
  `overrides` entry so the SDK's own nested zod resolves to the same
  patched version.
- Closed `192.0.0.0/24`, `192.88.99.0/24` and `198.18.0.0/15` in the CIMD
  SSRF guard's private-IP check, which previously let a `client_id`
  hostname resolve into those IANA special-purpose ranges.
- The login/OAuth-consent rate limiter no longer trusts `X-Forwarded-For`
  by default; it now keys on the real TCP peer unless `BRAINMD_TRUST_PROXY`
  explicitly opts in to a Cloudflare tunnel or a list of trusted proxy IPs.
- Persisted stores (auth, tokens, OAuth) now write through a unique,
  exclusive tmp file and unlink it on any failure in the write itself, not
  only on a failed rename, closing a cross-process clobber and an orphaned
  tmp-file leak.

### Fixed (since the 40 commits on `feat/identity-oauth`)

- `GET /health` no longer returns the vault's absolute filesystem path.
  It was reachable unauthenticated even with a password or an external
  login provider configured.
- Autocommit no longer changes the default git author identity for
  installs that have not configured a password or an external login
  provider. Unconfigured auth commits as `brain.md <brain@local>`, the
  same committer identity v0.4.12 always used, not the new owner-config
  default.
- `Autocommit.flush()` no longer drops a forced rerun request (e.g. a
  second `/api/git/flush` call arriving while a flush is already
  in-flight) when the in-flight flush's own path set turns out empty.

### Upgrading from 0.4.x

- If you have never set a password and never configured an external login
  provider, behaviour is unchanged: the server stays open on the local
  network, same as before.
- If you want external login, set the env vars above. Missing an allowlist
  is a startup error, not a silent open door.
- Password login keeps working exactly as before, whether or not an
  external provider is also configured.
