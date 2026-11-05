You are an independent senior reviewer. Review the change for work package {{WP_ID}} of
SV KI-Lotse. You have read-only access; do not modify anything.

Read AGENTS.md, the brief below, the PRD sections it references (docs/prd/SV-KI-Lotse-PRD.md) and
the diff below. Inspect surrounding code as needed.

Report only real problems, most severe first. For each finding give: severity (blocker, major,
minor), file and line, what is wrong, why it matters, and the exact change required. Focus on:
correctness against the acceptance criteria, security (secrets, approvals, injection, bridge
isolation), the medical boundary, data integrity, concurrency, error handling, missing or
tautological tests, and violations of the no-mock rule. Do not report style preferences.

Merge bar (owner decision 2026-11-05): only these block the merge and justify `VERDICT: REWORK`:
a blocker of any kind, or a major finding in security, safety (SR-1 and guards), the medical
boundary, data integrity, or an acceptance criterion that is not met. List every other finding
(other majors and all minors) after a heading `## Follow-ups` instead; they become a tracked
follow-up work package and do not block. Put blocking findings first, before `## Follow-ups`.

End with one line: `VERDICT: APPROVE` (no blocking findings) or `VERDICT: REWORK`.

## Brief

{{BRIEF}}

## Diff

```diff
{{DIFF}}
```
