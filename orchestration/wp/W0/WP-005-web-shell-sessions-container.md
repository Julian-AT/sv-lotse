---
id: WP-005
title: Web app shell, anonymous sessions and container
wave: W0
lane: web
risk: high
depends_on: [WP-004]
fr: [NFR-6, NFR-15, FR-L4, FR-P5]
owns:
  - apps/web/**
  - docs/adr/0005-sessions.md
may_touch:
  - bun.lock
allow_deps: next, react, react-dom, tailwindcss, @playwright/test, @axe-core/playwright
live_services: []
gates:
  - docker compose up -d --wait
  - bun run --filter @lotse/brain db:migrate
  - bun run --filter @lotse/web typecheck
  - bun run --filter @lotse/web lint
  - bun run --filter @lotse/web test
  - bun run --filter @lotse/web build
  - bun run --filter @lotse/web e2e --grep @smoke
  - bash apps/web/scripts/container-smoke.sh
pr_title: "feat(web): add app shell with anonymous sessions and container build"
---

# WP-005: Web app shell, anonymous sessions and container

## Goal

`apps/web` exists as the Next.js App Router app that hosts the brain's route handlers and the
workspace. After this WP:

- every visitor gets an anonymous session without any login;
- `/api/health` reports dependency status;
- the app builds as a standalone Node container and runs outside Vercel.

## Context

- PRD sections:
  - §7 (components, API routes, deployment);
  - §11 "Identity" (anonymous sessions, `requireSession`, demo reset);
  - §13 "Sessions";
  - NFR-6 (WCAG 2.2 AA) and NFR-15 (portability).
- There is no login in v1. Passkeys, e-mail magic links and identity providers are out of scope.
- The `user` and `session` tables come from WP-004; do not change the schema. If something is
  missing, raise a contract change request.
- Folder layout, used by later work packages:
  - `apps/web/src/app/...` for routes;
  - `apps/web/src/server/...` for server helpers;
  - `apps/web/src/conversation/...` and `apps/web/src/bridge/...` (WP-007);
  - `apps/web/src/features/...` for workspace features;
  - `apps/web/e2e/...` for Playwright.

  Do **not** create `apps/web/src/app/api/turn/` (WP-006 owns it).

## Deliverables

1. **Next.js app** (current stable), App Router in `src/app`, TypeScript strict.
   - `transpilePackages` for `@lotse/*`; `output: "standalone"`.
   - Tailwind (current major) or CSS modules; record which in the ADR.
2. **Environment.** `src/server/env.ts`: Zod-validated server environment. Fail fast with a readable
   error that lists missing variables (never their values).
3. **Telemetry.** `src/instrumentation.ts` registers AI SDK 7 telemetry with `@ai-sdk/otel` once per
   process (PRD §15); export to Langfuse only when its keys are present.
4. **Anonymous sessions** (`src/server/session.ts`):
   - On the first request without a valid cookie, create a `user` (kind `anonymous`) and a `session`,
     and set a signed cookie: httpOnly, SameSite=Lax, Secure outside localhost, HMAC with
     `SESSION_SECRET`.
   - Rotate the cookie on a schedule; expire idle sessions.
   - `requireSession(request)` returns `{ userId, sessionId, kind }` or a typed 401 for API routes.
     It is the single seam where real sign-in can be added later.
   - `/api/session`: POST creates or refreshes; DELETE ends the session and starts a fresh one (the
     "Neue Sitzung" demo reset).
5. **`/api/health`.** Checks the database (`select 1`) and object storage (head bucket). Returns JSON
   per dependency, 200 or 503; no session needed.
6. **Accessible layout shell.** Skip link, landmarks, language switch (de, en), focus styles, reduced
   motion, 44-point targets. A "Neue Sitzung" control lives in settings.
7. **`vercel.json`.** Functions region `fra1`.
8. **Container.**
   - `apps/web/Dockerfile`: multi-stage; install with `bun install --frozen-lockfile`, build the
     standalone output, run it on a slim Node 22 image as a non-root user with a `HEALTHCHECK`; runs
     migrations at start through the brain's migrator.
   - `apps/web/scripts/container-smoke.sh`: builds the image, runs it against the compose services
     with env from `.env.local`, polls `/api/health` until 200 or a timeout, then cleans up.
9. **Tests.**
   - Vitest for `env.ts`, cookie signing and verification (tampered, expired and foreign cookies are
     rejected), and `requireSession`.
   - Playwright `@smoke`:
     - the first visit gets a session cookie, and a reload keeps the same session;
     - "Neue Sitzung" yields a new session id;
     - the home page has no axe violations;
     - `/api/health` returns 200 with services up.
10. **`apps/web/AGENTS.md`.**
    - Route handlers contain no business logic and import `packages/brain`.
    - `requireSession` is the only way to identify a caller.
    - The workspace keeps no local state beyond UI preferences.
    - The commands for this app.
11. **ADR.** `docs/adr/0005-sessions.md`: anonymous sessions now, how accounts can be added later
    behind `requireSession`, cookie parameters and rotation.

## Acceptance criteria

- [ ] AC1: `build` succeeds. The standalone server starts. `/api/health` returns 200 with both services
  up and 503 with the database down.
- [ ] AC2: A first visit creates exactly one `user` and one `session` row and a valid cookie. A tampered
  cookie gets a new session, not an error page.
- [ ] AC3: `DELETE /api/session` ends the old session; the next request gets a new one (demo reset).
- [ ] AC4: The container smoke test passes (portability, NFR-15).
- [ ] AC5: axe finds no WCAG 2.2 AA violations on the home page.
- [ ] AC6: No secret reaches client bundles (a test greps `.next/static` for the server env names).

## Suggested commits

- `feat(web): add next.js app shell with env validation and telemetry`
- `feat(web): add anonymous sessions with signed cookies`
- `feat(web): add health endpoint and accessible layout`
- `build(web): add standalone container and smoke test`
- `docs(adr): record anonymous session decision`
