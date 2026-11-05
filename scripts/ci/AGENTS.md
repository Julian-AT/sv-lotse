# CI scripts

Scope: commit-policy helpers and their isolated tests. Workflows live in `.github/workflows/`.

## Commands

- `actionlint`: validate both workflows, including embedded shell commands.
- `bash -n scripts/ci/check-commits.sh`: check shell syntax.
- `bash scripts/ci/test-check-commits.sh`: exercise the real commitlint configuration against
  disposable Git objects in a temporary repository under this directory; remove it on exit.

## Invariants

- Import the root `commitlint.config.mjs`; never duplicate its header, scope or attribution rules.
- Disable commitlint's default message ignores in CI so every selected commit is checked.
- Check only the event range. An all-zero base means check the head alone, excluding legacy history.
- Fail closed if the allowed identity is missing or either revision cannot be resolved.
- Never write to the working repository's Git metadata. Only the test's disposable repository may
  receive Git writes.
- Keep provider keys in `nightly.yml`, referenced through repository secrets on the live-test step.
- `ci-ok` remains the sole required check. Detect optional inputs before job-level conditions, and
  aggregate every CI job even after failures or cancellations.

Root policy, package manifests, lockfiles and service definitions are read-only for this scope.
