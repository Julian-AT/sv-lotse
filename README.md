# SV KI-Lotse

A voice-first, screen-aware personal guide through Austria's health and social insurance system, built
for the Dachverband KI Challenge (Use Case 1).

- **Product requirements:** [docs/prd/SV-KI-Lotse-PRD.md](docs/prd/SV-KI-Lotse-PRD.md)
- **How it is built:** [ORCHESTRATION.md](ORCHESTRATION.md). Claude orchestrates; Codex CLI workers
  implement work packages in parallel; every change lands through a verified, reviewed pull request.
- **Rules for coding agents:** [AGENTS.md](AGENTS.md) (workers), [CLAUDE.md](CLAUDE.md) (orchestrator).

## Quick start

```bash
bash orchestration/bin/bootstrap.sh --github sv-ki-lotse   # one time
orchestration/bin/wp doctor
claude   # then: /orchestrate W0
```

## Repository layout

```
apps/web/          Next.js workspace and API routes hosting the brain        (from WP-005)
apps/mac/          macOS companion (SwiftUI/AppKit, derived from Clicky)     (from WP-008)
packages/brain/    agent, tools, process engine, guards, persistence          (WP-001 onwards)
packages/protocol/ Zod contracts, generated JSON Schema and Swift types       (WP-003)
packages/guide/    in-page guide runtime                                      (W1)
packages/knowledge/ catalog, processes, forms, offices, ingestion             (W1)
packages/evals/    evaluation suites E1 to E12                                (W1)
packages/ui/       shared accessible React components                         (WP-007)
orchestration/     wp pipeline, templates, work-package briefs
docs/              PRD and architecture decision records
```

## Third-party code

The macOS app is derived from Clicky (MIT). See `apps/mac/THIRD_PARTY_NOTICES.md` once WP-008 lands.
