# @lotse/web

## Scope and invariants

Next.js App Router shell and HTTP host for `packages/brain`. Read the root `AGENTS.md` and the
assigned brief before changing this app. Do not add conversation logic to this app.

- Route handlers contain no business logic; server helpers import the brain's public subpaths.
  `/api/turn` uses the brain root public runtime adapter implemented by WP-006.
- `requireSession(request)` in `src/server/session.ts` is the only way to identify a caller. It
  returns `{ userId, sessionId, kind }` or throws `SessionUnauthorized` (`status: 401`,
  `code: SESSION_REQUIRED`). API adapters must map this typed error to a 401 response. Never trust
  caller-supplied user/session ids or internal forwarding headers.
- Page requests create/refresh sessions in `src/proxy.ts`; APIs explicitly require sessions, except
  public `/api/health` and the create/reset `/api/session` route. Proxy excludes APIs and assets.
- Session reset expires the old session and retains its anonymous user so previous context stays
  available for export/deletion. Retain the user only from a successful conditional revocation in
  the replacement transaction; concurrent losers recover as new anonymous users. Historical session
  references remain intact. It is not deletion.
- A public `LOTSE_WORKSPACE_URL` pins the accepted browser origin. With the optional localhost
  default, use the request's authority (preserved Host behind proxies) and transport instead.
  X-Forwarded-Proto may upgrade to HTTPS; X-Forwarded-Host never selects the accepted origin.
  Insecure cookies require HTTP loopback in both the request URL and Host, with no conflicting
  public configuration or forwarding signals. All public requests receive Secure cookies.
- Public session cookies use `__Host-lotse_session` with Secure, Path=/ and no Domain. Only verified
  HTTP loopback uses `lotse_session`; public requests never fall back to that name. Reject duplicate
  session names in the raw Cookie header before Next.js parsing or preference-cookie mutations.
- The workspace keeps no local state beyond UI preferences. Pending/error UI is transient; never
  store facts, documents, conversations or caller identity in browser storage.
- Server environment is validated once at process startup, with name-only errors. Import server
  helpers only from server files. The build scans `.next/static` for server environment names and
  configured secret values. Never put secrets in `next.config.ts`'s `env` or public variables.
- AI SDK telemetry registers once per process. Langfuse export requires both keys; otherwise no
  exporter is installed. Runtime context and headers are excluded; exported sensitive fields are
  removed before Langfuse can process media, log or export them. This includes GenAI messages,
  system instructions, tool definitions, arguments/results and legacy AI SDK content. Langfuse
  receives only the status code; exception messages and stack traces are removed from span and event
  attributes while safe error types/codes remain. Media uploads are disabled.
  Future brain calls must set `recordInputs: false` and `recordOutputs: false` and never
  whitelist user content or tools context. PostHog is disabled until consent wiring is implemented.
- Use CSS modules for shell styling and minimal global accessibility/reset defaults (no Tailwind). Preserve landmarks, the skip link,
  visible focus, 44 CSS-pixel targets, German/English language metadata and reduced-motion support.
- Production deployment runs the brain migrator once before serving, serialized by deployment
  orchestration. `scripts/build-migrator.mjs` bundles the public brain migrator for Node and keeps
  its relative migration-folder layout. Bun is build tooling only; the runtime is Node 22.
- `/api/turn` identifies the caller with `requireSession`, validates the protocol-plus-latest-message
  body through the public brain adapter and returns the SDK UI stream. Map typed session/turn errors
  to their HTTP status, pass cancellation, and keep all conversation/approval logic in brain. Clients
  must retain `x-lotse-case-id` for the next request.
- Original challenge data and other packages are
  read-only. Generated `next-env.d.ts` comes from Next.js; never hand-edit it.

## Commands

Run from the repository root:

- `bun run --filter @lotse/web dev` — development server, loads root `.env.local` without overriding
  supplied variables.
- `bun run --filter @lotse/web typecheck` — strict TypeScript.
- `bun run --filter @lotse/web lint` — Biome lint, imports and formatting.
- `bun run --filter @lotse/web test` — Vitest unit project under Node; no env file or services needed.
- `bun run --filter @lotse/web test:services` — Vitest services project against real Postgres/MinIO.
- `bun run --filter @lotse/web build` — Next standalone build, Node migrator bundle, client env scan.
- `bun run --filter @lotse/web start` — standalone server on `127.0.0.1:3000`; copies static assets.
- `bun run --filter @lotse/web e2e --grep @smoke` — Playwright and axe against the standalone build.
- `bun run --filter @lotse/web test:integration` — service tests followed by the browser smoke suite.
- `node --experimental-strip-types apps/web/scripts/ci-env.mjs` — validate public Compose defaults
  and provision a fresh disposable signing key through `GITHUB_ENV` without logging values.
- `bash apps/web/scripts/container-smoke.sh` — build and run a non-root Node container on the Compose
  network, poll both dependencies and clean up. Use `COMPOSE_PROJECT_NAME` when using a shared stack.

Before service/browser tests, start `docker compose up -d --wait` and run
`bun run --filter @lotse/brain db:migrate`. Build the standalone server and install Playwright
Chromium before browser tests. Service scripts optionally load `.env.local` without overriding
supplied environment or logging its contents; CI uses environment-only configuration. Container
smoke validates runtime configuration before building. Session tests create/migrate/drop a unique
Postgres database; the configured local role needs CREATEDB. E2E needs installed Playwright Chromium
and a free port 3000. No live model/voice keys are required by this WP. Container builds exclude all
local env files and need no secrets; supply validated environment only at runtime. Some sandboxed
macOS environments block Chromium launch or Docker state writes. A matching remote Playwright
browser can run the same suite with `PW_TEST_CONNECT_WS_ENDPOINT=ws://127.0.0.1:3002/` and
`PW_TEST_CONNECT_EXPOSE_NETWORK='<loopback>'`. Set `BUILDX_CONFIG` to a writable directory if needed.
