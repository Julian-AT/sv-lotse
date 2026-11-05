---
id: WP-002
title: CI pipeline with commit policy, secrets scan and aggregate check
wave: W0
lane: ci
risk: normal
depends_on: [WP-001]
fr: [NFR-9, NFR-13, NFR-15, NFR-17]
owns:
  - .github/**
  - scripts/ci/**
may_touch: []
allow_deps: none
live_services: []
gates:
  - actionlint
  - bash -n scripts/ci/check-commits.sh
  - bash scripts/ci/test-check-commits.sh
pr_title: "ci(repo): add pull request and main pipeline with commit policy checks"
---

# WP-002: CI pipeline with commit policy, secrets scan and aggregate check

## Goal

Every pull request and every push to main is checked by GitHub Actions. One aggregate job, `ci-ok`,
is the single required status check that `wp land` waits for and the branch ruleset requires.

## Context

- PRD §14 (continuous integration), §17 (CI).
- The commit policy is `commitlint.config.mjs` (read-only for you) plus the author rule enforced by
  `.husky/pre-commit`. Reuse commitlint; do not re-implement header rules.
- Repository variable `ALLOWED_AUTHOR_EMAIL` holds the owner's e-mail (the orchestrator asks the owner
  to set it with `gh variable set ALLOWED_AUTHOR_EMAIL`).
- Later packages add scripts such as `test:integration`, the Dockerfile and the Swift protocol package.
  The pipeline must pick these up conditionally, so nobody has to edit CI in every work package.

## Deliverables

1. `.github/workflows/ci.yml`:
   - **Triggers:** `pull_request` and `push` to `main`. A concurrency group cancels superseded runs of
     the same ref. Minimal `permissions` (`contents: read`).
   - **Job `verify`:** checkout, Bun via `oven-sh/setup-bun` at the `packageManager` version, Node
     from `.nvmrc`, `bun install --frozen-lockfile`, `bun run verify`, `bun run format:check`.
   - **Job `commits`:**
     - checkout with full history;
     - check the PR range (`base.sha..head.sha`) or the push range (`before..after`; for a first push,
       only `after`) with `scripts/ci/check-commits.sh` against `vars.ALLOWED_AUTHOR_EMAIL`;
     - the check enforces Conventional Commits, the scope list, no merge commits, no fixup commits,
       no AI attribution, and author and committer equal to the allowed e-mail.
   - **Job `secrets`:** gitleaks over the commit range with the gitleaks CLI or the official container
     image (no paid action).
   - **Job `integration`:** runs only if `docker-compose.yml` exists (`hashFiles`).
     `docker compose up -d --wait`, `bun install --frozen-lockfile`, `bun run test:integration`, with
     `DATABASE_URL` and the S3 variables pointing at the compose services.
   - **Job `container`:** runs only if `apps/web/Dockerfile` exists. Runs
     `bash apps/web/scripts/container-smoke.sh`.
   - **Job `protocol-swift`:** runs only if `packages/protocol/swift/Package.swift` exists.
     `swift test --package-path packages/protocol/swift` on `ubuntu-latest` (Swift toolchain setup
     action) or `macos-latest`. Choose and justify in the workflow comment.
   - **Job `ci-ok`:** `needs` all jobs above, `if: always()`. It fails if any needed job failed or was
     cancelled. Skipped conditional jobs count as success. This is the required check.
2. `.github/workflows/nightly.yml`: `schedule` (once a night, Europe/Vienna) and `workflow_dispatch`.
   Runs `RUN_LIVE=1 bun run test:live` with provider keys from repository secrets (names as in
   `.env.example`). Not required for merging.
3. `scripts/ci/check-commits.sh <base> <head>`: runs `bunx commitlint --from <base> --to <head>` and
   checks that every commit's author and committer equal `ALLOWED_AUTHOR_EMAIL`, with no merge or
   fixup commits; exits non-zero with readable output. History before the commit policy existed (the repository's
   first commits) is never checked: CI checks only PR and push ranges.
   `scripts/ci/test-check-commits.sh` builds a temporary repository and proves that good commits pass
   and that bad ones fail: wrong author, bad header, co-author trailer, merge commit.
4. `.github/pull_request_template.md`: the same sections as `orchestration/templates/pr-body.md`.
5. Pin every third-party action to a full commit SHA, with the version in a trailing comment.

## Acceptance criteria

- [ ] AC1: `actionlint` reports no errors.
- [ ] AC2: `test-check-commits.sh` passes; it proves good commits pass and crafted bad ones fail.
  It runs in a temporary repository under `scripts/ci/`.
- [ ] AC3: `ci-ok` is the only job that branch protection needs to require; conditional jobs are
  skipped cleanly when their files do not exist yet.
- [ ] AC4: No secret values appear in workflow files. Live keys are referenced only through `secrets.*`
  in `nightly.yml`.

## Notes for the implementer

- Use `hashFiles('docker-compose.yml') != ''` style conditions at job level.
- After this lands, the orchestrator runs `wp protect` to require `ci-ok` on `main`.

## Suggested commits

- `ci(repo): add verify, commits and secrets jobs with ci-ok aggregate`
- `ci(repo): add conditional integration, container and swift protocol jobs`
- `ci(repo): add nightly live test workflow`
