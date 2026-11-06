# Voice autonomy and sharing controls

status: done

Implemented FR-A1 and FR-R5 using existing server authority services.

- Sourced German/English exact-utterance rules live in `packages/knowledge/data/turn-controls.json`, with a validated public `turn-controls` loader/detector. Negated, quoted and embedded commands do not match.
- The turn runtime intercepts these controls before communication classification, goal classification, retrieval and model execution. Autonomy requests emit one persisted confirmation card. Only the next explicit confirmation from the same actor/session writes through `createAutonomyService.change`, also used by `/api/settings/autonomy`. Decline leaves the level unchanged; stale cards and caller metadata confer no authority.
- Pause calls the existing helper-session pause action for active sessions in the current case. It revokes helper case scope and emits caption/speech confirmation. It can interrupt a pending tool approval without consuming or dispatching it. Other cases remain shared.
- Both conversation views render the card. The autonomy settings panel refreshes after voice/text turns and displays the exact reviewed pages returned by the existing booking authorization policy at L3. Empty policy produces an explicit empty state; no pages were invented or added.

## Verification

- `bun run typecheck`: exit 0, all eight workspace packages plus demo scripts.
- `bun run --filter @lotse/brain test:autonomy:integration`: 13 tests passed against disposable migrated real Postgres databases.
- `bun run --filter @lotse/web test -- test/autonomy.test.ts test/autonomy-controls.test.ts`: 9 tests passed.
- `bun run --filter @lotse/knowledge test -- test/turn-controls.test.ts`: 11 tests passed.
- `bun run --filter @lotse/knowledge e2:scan`: passed.
- Biome check on all 27 changed/new code and data files: passed. `git diff --check`: passed.
- The final DB suites assert provider fetch was never called. New control tests also assert zero SDK model calls.

## Deviations and environment

- Reused the helper-session action by narrowing its dependency to `Pick<Database, "sql">`; the runtime supplies the existing Drizzle connection. No second database service, migration or protocol change was introduced.
- Added an optional authenticated `GET /api/settings/autonomy?include=fill-pages` projection and a browser-safe autonomy metadata schema export.
- The older settings DB suite lacked classifier/guard isolation and confirmed-goal setup. An initial run reached that unisolated classifier and failed. Fixed its test-only provider boundaries without removing assertions; the final suite forbids provider network calls.
- Starting another Compose stack failed because Docker's subnet pools were exhausted. Tests used the already running real Postgres service successfully; no shared services were removed.
- Not run: live-model suites, browser E2E and native Mac tests. No secrets, original challenge data, PRD or orchestration files changed. No Git write commands were run.
