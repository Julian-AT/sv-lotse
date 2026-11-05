---
id: WP-005
title: Web app shell, authentication and container
wave: W0
lane: web
risk: high
depends_on: [WP-004]
fr: [NFR-6, NFR-15, FR-L4]
owns:
  - apps/web/**
  - packages/brain/src/db/schema/auth.ts
  - docs/adr/0005-authentication.md
may_touch:
  - packages/brain/src/db/schema/index.ts
  - packages/brain/drizzle/**
  - pnpm-lock.yaml
allow_deps: next, react, react-dom, tailwindcss, the auth library chosen in the ADR, @playwright/test
live_services: [resend]
gates:
  - docker compose up -d --wait
  - pnpm --filter @lotse/brain db:migrate
  - pnpm --filter @lotse/web typecheck
  - pnpm --filter @lotse/web lint
  - pnpm --filter @lotse/web test
  - pnpm --filter @lotse/web build
  - pnpm --filter @lotse/web e2e -- --grep @smoke
  - bash apps/web/scripts/container-smoke.sh
pr_title: "feat(web): add app shell with passkey auth and container build"
---

# WP-005: Web app shell, authentication and container

## Goal

`apps/web` exists as the Next.js App Router app that hosts the brain's route handlers and the
workspace. After this WP:

- users can sign in with passkeys or e-mail magic links;
- `/api/health` reports dependency status;
- the app builds as a standalone Node container and runs outside Vercel.

## Context

- PRD §7 (components, API routes, deployment), §11 "Identity", §13 "Account security", NFR-6
  (WCAG 2.2 AA), NFR-15 (portability).
- Folder layout, used by later work packages:
  - `apps/web/src/app/...` for routes;
  - `apps/web/src/server/...` for server helpers;
  - `apps/web/src/conversation/...` and `apps/web/src/bridge/...` (WP-007);
  - `apps/web/e2e/...` for Playwright tests.

  Do **not** create `apps/web/src/app/api/turn/` (WP-006 owns it).
- The database schema belongs to WP-004. Add only the auth tables, in `schema/auth.ts`, and the
  migration generated for them.

## Deliverables

1. **Next.js app** (current stable), App Router in `src/app`, TypeScript strict.
   - `transpilePackages` for `@lotse/*`; `output: "standalone"`.
   - Tailwind (current major) or CSS modules; record which in the ADR.
2. **Environment.** `src/server/env.ts`: Zod-validated server environment. Fail fast at startup with
   a readable error that lists missing variables (never their values).
3. **Telemetry.** `src/instrumentation.ts` registers AI SDK 7 telemetry with `@ai-sdk/otel` once per
   process (PRD §15). Exporting to Langfuse is configured only when its keys are present.
4. **Authentication** (decision in `docs/adr/0005-authentication.md`). The recommended choice is Better
   Auth with its Drizzle adapter, plus the passkey and magic-link plugins; e-mail goes through Resend.
   - Auth tables are added in `packages/brain/src/db/schema/auth.ts` with a generated migration.
   - The `requireSession(request)` helper for route handlers returns the user id and session id.
   - The sign-in page offers a passkey and an e-mail magic link.
   - If `RESEND_API_KEY` is missing, magic links are disabled with a clear UI message. Passkeys still
     work. Never fake an e-mail send.
5. **`/api/health`.** Checks the database (`select 1`) and object storage (head bucket). Returns JSON
   per dependency, 200 or 503; no auth.
6. **Accessible layout shell.** Skip link, landmarks, language switch (de, en), focus styles, reduced
   motion, 44-point targets.
7. **`vercel.json`.** Functions region `fra1`.
8. **Container.**
   - `apps/web/Dockerfile`: multi-stage, pnpm workspace pruning, standalone output, non-root user,
     `HEALTHCHECK`, runs migrations at start through the brain's migrator.
   - `apps/web/scripts/container-smoke.sh`: builds the image, runs it against the compose services
     with env from `.env.local`, polls `/api/health` until 200 or a timeout, then cleans up.
9. **Tests.**
   - Vitest for `env.ts` and `requireSession`.
   - Playwright (`@smoke`):
     - the home page and sign-in page render with no axe violations (axe-core);
     - `/api/health` returns 200 with services up;
     - passkey registration and sign-in through Playwright's virtual WebAuthn authenticator (Chrome
       DevTools Protocol) create a real session.
   - Live: a magic-link request to `delivered@resend.dev` is accepted by Resend (`@live`).
10. **`apps/web/AGENTS.md`.**
    - Route handlers contain no business logic and import `packages/brain`.
    - The workspace keeps no local state beyond UI preferences.
    - The commands for this app.

## Acceptance criteria

- [ ] AC1: `build` succeeds; the standalone server starts and `/api/health` returns 200 with both
  services up and 503 with the database down.
- [ ] AC2: A passkey sign-up and sign-in through the virtual authenticator creates a session that
  `requireSession` accepts.
- [ ] AC3: The container smoke test passes (portability, NFR-15).
- [ ] AC4: axe finds no WCAG 2.2 AA violations on the home and sign-in pages.
- [ ] AC5: No secret reaches client bundles (a test greps `.next/static` for the server env names).

## Suggested commits

- `feat(web): add next.js app shell with env validation and telemetry`
- `feat(web): add passkey and magic-link authentication`
- `feat(db): add authentication tables`
- `feat(web): add health endpoint and accessible layout`
- `build(web): add standalone container and smoke test`
- `docs(adr): record authentication decision`
