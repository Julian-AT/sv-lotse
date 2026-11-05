---
description: Check a milestone gate (M0 to M5) and report to the owner
argument-hint: "<M0|M1|M2|M3|M4|M5>"
---

Prepare the milestone report for: $ARGUMENTS

1. Look up the milestone's gate in the ORCHESTRATION.md milestone gates and the PRD, section 18 ("Milestones
   and gates").
2. Run every gate command on an up-to-date main checkout.
   - Run it in a temporary worktree: `git worktree add ../lotse-gate-check origin/main`.
   - Load `.env.local` through the environment; do not print it.
   - Remove the worktree afterwards.
3. Collect:
   - the WPs landed in this wave, with PR links (`wp status`);
   - gate results: command, pass or fail, key numbers;
   - evaluation results available so far (suite, value, interval, target);
   - deviations from the PRD and the ADRs written in this wave;
   - open contract change requests, follow-ups and known defects;
   - risks for the next wave;
   - token usage per WP (`wp status`) and the total.
4. Present the report to the owner in under 40 lines and propose the next wave's first batch.
5. Stop and wait for the owner's "go".
   - After the go: `orchestration/bin/wp tag <milestone in lower case> "<milestone name>"`.
   - If a gate failed: propose the fix WPs instead of tagging.
