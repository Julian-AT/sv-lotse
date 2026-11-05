# ADR 0005: Anonymous sessions behind one identity seam

- Status: accepted for WP-005
- Date: 2026-11-05
- Requirements: PRD §7, §11 Identity, §13 Sessions, §15; NFR-6, NFR-15, FR-L4, FR-P5

## Decision

Use anonymous Postgres users and sessions, with no login in v1. The Next.js App Router app imports
the brain's database, schema and S3 subpaths. Its route files delegate to server helpers; they hold
no business logic. Use CSS modules for the shell, with minimal global accessibility/reset defaults. The shell has German and
English copy, language metadata, landmarks, keyboard focus, a skip link and 44 CSS-pixel targets.

`requireSession(request)` is the single identity seam. It validates the cookie and a live database
session, updates activity and returns `{ userId, sessionId, kind }`. Missing, malformed, forged,
expired and unknown sessions produce a typed `SessionUnauthorized` with status 401 and code
`SESSION_REQUIRED`. Other failures propagate; database outages must not create replacement users.
Page navigation and POST `/api/session` recover invalid cookies by creating a new anonymous user and
session together in one transaction. APIs never silently create a caller identity. Health is public.

DELETE `/api/session` atomically expires the previous session and issues a fresh session for the same
anonymous user only when its conditional revocation succeeds. Authorization alone does not grant
replacement rights: concurrent resets that lose revocation create a new anonymous user, as for an
invalid session. Retaining the user keeps previous data accessible for export and deletion (FR-P5);
the new session starts with no active conversation selected. Keep expired session rows and their
historical references, including approvals. Reset is not data deletion. Cross-origin browser session
writes are rejected against the resolved deployment/request origin; native requests may omit Origin.

## Cookie and lifecycle

- Name: `__Host-lotse_session`, host-only, Path=/, httpOnly, SameSite=Lax and Secure. The browser
  prefix prevents sibling subdomains from planting parent-domain or path-scoped credentials.
  Verified HTTP loopback alone uses `lotse_session`. Public requests never accept that legacy name,
  including on a first visit. Reject duplicate session names in the raw Cookie header before
  Next.js collapses them into a map; preference-cookie changes run after session validation.
- Secure outside verified HTTP loopback requests (localhost, 127.0.0.1 and ::1). The optional
  localhost workspace default does not decide cookie security or pin the accepted public origin.
  A configured public `LOTSE_WORKSPACE_URL` pins the origin; otherwise resolve it from the request
  URL and Host. Reverse proxies must preserve Host or configure the public workspace URL.
  X-Forwarded-Proto can upgrade the resolved transport to HTTPS, never downgrade it.
  X-Forwarded-Host never selects the origin, and conflicting forwarding signals prevent insecure
  cookies. HTTPS loopback also receives Secure cookies.
- Payload: version 1, opaque session UUID and issuance time, base64url encoded. Sign with
  HMAC-SHA256 over a cookie-specific versioned domain and payload using `SESSION_SECRET` (minimum
  32 characters). Compare fixed-length signatures in constant time; reject noncanonical signatures,
  oversized cookies, invalid payloads, future issuance and expired signatures.
- Browser cookie and signature lifetime: 30 days. Database session absolute lifetime: 30 days.
  Database idle timeout: 30 minutes, extended on each authenticated request, bounded by the absolute
  lifetime. The database decides idle expiry independently of cookie validity.
- Reissue the cookie every 15 minutes on page navigation or POST `/api/session`, retaining the
  session/user ids. Rotation refreshes issuance and the signature, not identity. Earlier signatures
  overlap while their database session and their own lifetime remain valid. Reset and database
  expiry revoke all signatures for that session immediately. A changed SESSION_SECRET invalidates
  every existing signature; no signing keys or session state enter the client bundle.

The existing WP-004 schema suffices. Expiry updates take a row lock and predicate on the unexpired
session, comparing expiry to the database wall clock again after lock waits. This prevents a request
that arrived before reset from reviving the revoked session. No migration,
provider-specific identity feature or process-local session store is needed.

## Hosting and telemetry

Build standalone Next.js output with monorepo tracing and workspace transpilation. Vercel uses fra1;
the same output runs on slim Node 22 as a non-root user. A separately bundled Node entrypoint invokes
the brain's public migrator before the server starts; the container includes committed migrations.
No secrets are supplied during image builds. Health performs a real SELECT 1 and S3 HeadBucket,
returns per-dependency status and 200/503, uses no session and is never cached. Dependency checks have
a bounded response time and omit error details that could contain credentials.

Validate environment once at server startup and report only missing/invalid variable names. Build
workers do not need runtime credentials. Optional workspace URL and SV-Box directory default to
localhost:3000 and data/svbox. Langfuse and PostHog keys are optional and remain out of `.env.example`.
Register AI SDK 7 OpenTelemetry once per process. Install a Langfuse exporter only with both keys;
remove GenAI messages, system instructions, tool definitions, arguments/results, embedding content
and legacy AI SDK content before Langfuse receives spans, in addition to its built-in masking.
Drop free-text status messages and exception message/stack attributes on spans and events before
delegation; retain status codes and safe exception types/codes, even when input/output recording is
disabled. Validation errors can serialize sensitive input values independently of prompt recording.
Disable media uploads and exclude runtime context and request headers. PostHog remains off.
No paid/live model or voice service is needed for the shell.

## Adding accounts later

Preserve `requireSession` and its caller contract. A later, separately reviewed schema migration can
add account kinds and credentials/provider identities and associate existing anonymous context with
an account after proof of ownership. Implement sign-in, recovery and identity linking behind this
seam, so route handlers and clients continue using the same server-resolved identity. Do not infer
identity from request bodies, invent a second Mac identity or move persistent context to clients.

## Verification and sources

Vitest covers name-only env errors, optional defaults, signing/forgery/expiry and real Postgres
creation, refresh, idle expiry, signature rotation, reset and concurrent revocation under real
Postgres row locks. Cookie-shadowing tests cover both raw
header orders, first-visit fixation and navigation with language changes. Real-service health covers 200 and
unavailable-database 503. Playwright smoke checks cover the standalone page lifecycle, reset, axe in
both languages, keyboard navigation and public health. Build fails if server environment names or
configured secret values appear in `.next/static`. Container smoke builds, migrates, polls both
services, checks the runtime uid and cleans up. Unit tests need neither environment configuration
nor services; the separate service project retains every real Postgres/MinIO assertion. Integration
CI provisions validated Compose defaults and a disposable signing key, starts services, migrates,
builds standalone output and installs Chromium before service/browser tests. Container CI provisions
the same configuration and services; the image migrates on startup. Both jobs always clean up Compose.
Local env files are optional in both paths.

- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Next.js Proxy and cookies](https://nextjs.org/docs/app/api-reference/file-conventions/proxy)
- [Next.js instrumentation](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- [AI SDK 7 telemetry](https://ai-sdk.dev/docs/ai-sdk-core/telemetry)
- [Langfuse OpenTelemetry integration](https://langfuse.com/integrations/frameworks/vercel-ai-sdk)
- [Drizzle transactions](https://orm.drizzle.team/docs/transactions)
- [Vitest test projects](https://vitest.dev/guide/projects)
- [Playwright continuous integration](https://playwright.dev/docs/ci)
- [Langfuse masking](https://langfuse.com/docs/observability/features/masking)
