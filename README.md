# SV KI-Lotse

A voice-first, screen-aware guide through Austria's health and social insurance system: Dachverband KI
Challenge, Use Case 1.

| Path | Content |
| --- | --- |
| `docs/prd/SV-KI-Lotse-PRD.md` | Product requirements |
| `docs/svbox-inventory.md` | What the challenge data contains |
| `docs/challenge/use-case.pdf` | Use case brief and jury criteria from the organizers |
| `data/svbox/` | Original challenge data (private, KI Challenge 2026 only) |
| `ORCHESTRATION.md` | How the project is built: waves, pipeline, commit standard |
| `CLAUDE.md`, `AGENTS.md` | Rules for the orchestrator and the coding agents |
| `orchestration/` | Work-package pipeline (`bin/wp`), briefs, templates |
| `KI-Challenge_UseCase.yaml` | Selected use case (do not move or delete) |

## Start

```bash
orchestration/bin/setup   # tools, logins, bun install, .env.local, wp doctor
claude                    # then /orchestrate W0
```

The macOS app is derived from Clicky (MIT); see `apps/mac/THIRD_PARTY_NOTICES.md` once it exists.
