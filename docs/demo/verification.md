# Scenario 3 verification — 2026-11-06

Status: **partial**. The seed, operator script and full live Playwright test are implemented.
There is **no passing full live E2E result**. OpenAI began returning HTTP 429 quota/budget errors
on both embeddings and responses during rehearsal. Restore quota for the configured project,
then rerun the command in [run.md](./run.md#automated-live-rehearsal). No credentials or environment
files were changed.

## Verified

- `bun run typecheck`: all eight workspaces and the demo scripts pass.
- `bun run lint` and focused Biome checks pass.
- Web conversation, office, evidence, PDF assets, API and viewer unit tests: 29 pass.
- Brain pipeline, guard, catalog and safe stream-error unit tests: 33 pass.
- Directory unit tests plus real Postgres directory/process and Postgres/MinIO form tests:
  26 pass. These exercise sourced offices/facilities, contact drafts, tentative ICS output,
  approval consumption, form persistence and process transitions.
- Web viewer service tests against real Postgres/MinIO: 4 pass.
- Real Postgres goal-confirmation and context-privacy regressions: 2 pass.
- Before quota exhaustion, live classifier checks passed for administrative document work,
  explicit goal confirmation and refusal of a clinical request.
- The original seed successfully migrated, loaded the full catalog, registered the original
  two-page/116-field form, indexed both official sources and created an empty demo subject/case.
  Repeat ingestion returned unchanged/not-modified results.
- Live browser attempts demonstrated original PDF upload/extraction, grounded recommendation
  highlighting, explicit goal persistence, actual catalog selection, sourced office lookup,
  the original form, a sourced keyboard correction and real live typing. They exposed integration
  issues that were fixed; they did not complete the entire approval-to-journey sequence together.
- Playwright discovers exactly one opt-in live demo test; normal smoke tests exclude it.

## Integration changes beyond the demo files

- Render the grounded original document page alongside extracted facts.
- Show successful sourced office results directly, including contact details and expandable
  evidence, even when generated prose is withheld. Invalid or unsourced records are not rendered.
- Mount the authoritative prepared form inside the conversation; route browser form actions to
  the existing viewer and show exact server-owned field-group approvals there.
- Supply authenticated case/subject and current owner-visible form references to the model.
- Project retrieval evidence onto the strict citation verifier contract, preserving the verifier.
- Keep administrative document requests distinct from clinical interpretation, and keep preparation
  substeps within the existing confirmed goal.
- Serve PDF assets through Node filesystem resolution and support the Webpack development server's
  filesystem asset paths. The EKO/fee loaders retain repository-root/SVBOX_DIR resolution.
- Accept the catalog's existing free-text facility opening hours, display them verbatim and leave
  contact-window matching unknown for that format. This fixed a real directory-wide parse failure.
- Remove a reverse knowledge-to-brain database import by using the existing public database package.
- Normal generators refreshed the guide bundle, Next environment types and Next agent-rules block;
  these generated files were not hand-edited.

## Outstanding gates

- Full live Playwright success remains blocked by provider quota. The final test changes and the
  downstream live approval, checklist, facility, appointment and journey sequence need a fresh run.
  The test retains its actual-tool-output, UI acknowledgement and persisted-state assertions.
- `bun run verify` fails the existing knowledge E2 scan on `prevention`, `rehabilitation` and `care`
  literals in brain prompt/copy modules. No scanner or test was weakened.
- The full brain unit suite reports 336 passing and 2 failing tests: runtime `AC2` tests in
  `contracts.test.ts` and `conversation.test.ts` still expect the now-real
  `docs.extractStatements` tool to be an unimplemented fixture. Real extraction was retained.
- Local Chromium launch is blocked by the macOS sandbox; live attempts used a matching remote
  Playwright browser with loopback exposure. The shared Docker services were reused because creating
  another Compose network exhausted the host's address pools.
- A separate disposable database was used because the shared development database has migration
  drift. The runner drops only its own unique database; owned debugging data and uploaded objects
  were removed. The shared content-addressed original form remains available.

Original SV-Box files, the PRD and secrets were not modified.
