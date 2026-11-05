---
description: Run or resume the SV KI-Lotse work-package pipeline for a wave
argument-hint: "<wave, e.g. W0> | resume"
---

Run the orchestration pipeline for: $ARGUMENTS

Follow CLAUDE.md and ORCHESTRATION.md exactly.

1. Run `orchestration/bin/wp doctor`. If it fails, report the failing items to the owner and stop.
2. Run `orchestration/bin/wp status` and `orchestration/bin/wp ready`, and read the last 40 lines of
   `.orchestration/journal.md`.
3. If the briefs for this wave do not exist yet, write them first.
   - Use the ORCHESTRATION.md wave tables and `orchestration/templates/brief.md`.
   - Commit them through `wp orch <wave>-briefs`, then PR and land them.
   - Keep each brief small, with non-overlapping `owns`.
4. Fill the pipeline.
   - Start a background `orchestration/bin/wp batch <WP...>` with up to MAX_PARALLEL ready WPs
     whose paths do not overlap.
   - Prefer WPs on the critical path (the ORCHESTRATION.md wave tables).
5. As each WP finishes:
   - read its `verify.json`;
   - spawn the `wp-reviewer` subagent (and run `wp xreview` for `risk: high`);
   - rework or commit;
   - run `wp pr` and `wp land`;
   - immediately start the next ready WP.
6. Continue until every WP of the wave has landed. Then run `/milestone` for the wave's milestone and
   wait for the owner.

After each landed WP, give the owner a one-line update: WP, PR link, commits, anything notable. Ask
nothing within the wave unless CLAUDE.md lists it under "Stop and ask the owner".
