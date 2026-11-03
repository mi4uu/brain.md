# Security Policy

## Supported versions

Only the latest minor release line gets security fixes. Upgrade before
reporting anything that a newer release might already have fixed.

| Version | Supported |
|---|---|
| 0.4.x (latest minor) | yes |
| < 0.4 | no |

## Reporting a vulnerability

Report privately through GitHub's security advisories for this repo, not
through a public issue, discussion or PR:

https://github.com/mi4uu/brain.md/security/advisories/new

This uses GitHub's private vulnerability reporting, so the report and any
back-and-forth stay visible only to you and the maintainer until a fix
ships.

You'll get an acknowledgement within **5 business days**, and a decision on
severity and next steps within **14 days** of that. Fix timelines after that
depend on severity: there's no fixed SLA, but a confirmed report that lets
an attacker read or write someone else's vault, or get code execution, is
the priority.

## Scope

In scope:
- the server (`server/`): auth, the HTTP API, the MCP transport, OAuth
  2.1 flow, the web app's static serving, the vault filesystem layer
- the web client (`web/`) as served by the bundled server
- the install scripts (`install.sh`, `install.ps1`)

Out of scope:
- vulnerabilities that need physical or root access to the machine
  brain.md runs on
- issues in a self-hosted dependency you pointed brain.md at yourself
  (your own Ollama/LM Studio instance, a reverse proxy you configured)
- social engineering, and reports with no plausible attack path

## Security model

brain.md is a single self-hosted binary: one Bun process, one vault
directory on disk, no managed backend. There's no multi-tenant server to
compromise other than the one you're running yourself.

**Auth modes** (can be combined or left off for strictly local/loopback
use):
- **Password** — a single owner password (scrypt-hashed), issuing bearer
  session tokens for the web UI. This is the default and stays available
  regardless of what else is configured.
- **API keys** — long-lived named tokens for scripts/MCP clients, scoped
  like an agent (subject to per-folder MCP permissions).
- **OAuth 2.1** (optional) — authorization-code + PKCE for MCP clients,
  gated by the same owner password at the consent screen. Dynamic client
  registration is open (RFC 7591); trust comes from the password gate, not
  from pre-registration.

With no password configured, the server relies on a Host/Origin allowlist
(`ALLOWED_HOSTS`) to block browser-based DNS-rebinding attacks instead —
fine for pure loopback or a trusted LAN, not for exposing the port
directly to the internet.

**What leaves the machine:**
- By default, nothing. The embedding model for semantic search runs
  locally via bundled WASM ONNX (`bge-small-en-v1.5`); note content never
  leaves the process for indexing or search.
- If you switch the RAG provider to **OpenAI-compatible** in Settings, note
  text is sent to whatever `baseURL` you configure there for embedding —
  OpenAI's API, a remote Ollama/LM Studio instance, or anything else
  speaking that protocol. This is opt-in and off by default.
- OAuth client metadata (CIMD) is fetched over HTTPS from a client's own
  `client_id` URL when you connect an MCP client that uses that scheme;
  this is metadata about the connecting app, not vault content.
- Git autocommit (if enabled) is local only; brain.md never pushes to a
  remote.
