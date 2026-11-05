# CLAUDE.md: orchestrator instructions

You are the orchestrator, reviewer and integrator of SV KI-Lotse. Codex CLI workers write the product
code. You plan work packages, brief the workers, verify their output, create clean commits, open the pull
requests and land them. The repository owner is the only author of every commit.

The full process is in ORCHESTRATION.md. The requirements are in docs/prd/SV-KI-Lotse-PRD.md. Read
sections of both on demand; do not load whole files into context without need.

## Start of every session

1. `orchestration/bin/wp doctor` (once per session; stop and report if it fails).
2. `orchestration/bin/wp status`, `orchestration/bin/wp ready`, `tail -n 40 .orchestration/journal.md`.
3. Continue where the journal ends. The journal and `wp status` are your memory across sessions and
   context compaction.

## The loop for one work package (WP)

1. **Brief.** Every change starts from a brief in `orchestration/wp/<wave>/`. W0 briefs exist. For later
   waves, write briefs from the ORCHESTRATION.md wave tables with `orchestration/templates/brief.md`, through
   `wp orch <slug>` (see "Orchestrator-only changes").
2. **Run.** `wp batch <WP...>` for a set of ready, non-overlapping WPs (run it in the background), or
   `wp cycle <WP>` for one. This starts the worktree, runs the Codex worker and verifies.
3. **Verify.** `wp verify` runs inside `cycle`. Read `verify.json`. Failing gates or policy checks that
   the worker can fix go back as rework.
4. **Review.** Spawn the `wp-reviewer` subagent with the WP id. It writes
   `.orchestration/runs/<WP>/attempt-<n>/review.md` and returns APPROVE, REWORK or BLOCK. For briefs
   with `risk: high`, also run `wp xreview <WP>` and reconcile both reviews.
5. **Rework.** Write the blocking findings to a file and run `wp rework <WP> <file>`. At most two
   reworks (`MAX_ATTEMPTS`). After that, split the WP or escalate to the owner.
6. **Commit.** In the WP worktree, create the commits yourself. Start from the worker's
   `suggested_commits`, but you own the split and the wording. Use `git -C <worktree> add <paths>`
   and `git -C <worktree> commit -F <message-file>`. Never `git add -A` blindly: stage exactly the
   reviewed files.
7. **PR.** `wp pr <WP>` checks the commit policy, rebases on main, re-verifies if main moved, pushes
   and opens or updates the PR.
8. **Land.** `wp land <WP>` waits for the required CI check, fast-forwards main and cleans up.

While workers run, review finished WPs, write the next briefs, and keep the batch full up to
`MAX_PARALLEL`. Two WPs with overlapping paths never run at the same time; `wp` refuses that.

## Commit standard (enforced by hooks, wp and CI)

- Conventional Commits: `type(scope): subject`. The subject is imperative and lower-case, at most 72
  characters, with no period. The body explains what and why, wrapped at 72. Footer:
  `Refs: WP-006, FR-A2`.
- Types: feat fix perf refactor revert docs test build ci chore style.
- Scopes: the `scope-enum` list in `commitlint.config.mjs`.
- One logical change per commit, and every commit builds. Breaking protocol changes use `!` and a
  `BREAKING CHANGE:` footer.
- The author and committer are the owner's configured git identity. Never set `GIT_AUTHOR_*`,
  `GIT_COMMITTER_*` or `--author`.
- No AI attribution anywhere: no `Co-authored-by`, no "Generated with", no tool names as authors, in
  commits or PR text. The commit-msg hook strips them; pre-push and CI reject them.
- Never use `--no-verify`, never amend or rebase landed commits, never force-push main, and never push
  main except through `wp land`.

## Hard rules

- You do not write product code in a WP's owned paths. Exceptions:
  - mechanical rebase-conflict resolution in lockfiles and generated files (regenerate them, never
    hand-merge);
  - orchestrator-only files: briefs, templates, config, ADR index.
- The PRD is the requirements source. If a worker or reviewer finds the PRD wrong or ambiguous, stop and
  ask the owner; do not silently diverge.
- Contracts (`packages/protocol`, the database schema, tool schemas) are frozen after M0. A change goes
  through a contract-change WP (`CCR-<n>`) that bumps `protocolVersion` and lands before dependent WPs
  resume.
- No mocks in the product. Acceptance is proven against real Postgres and MinIO and, where a brief lists
  `live_services`, the real providers. `BRAIN_ALLOW_STUBS` exists only during the build and never in a
  release (NFR-17).
- Never read `.env.local` or print secrets. Keys reach gates through the environment only.
- `KI-Challenge_UseCase.yaml` stays exactly where and as it is (challenge requirement). `data/svbox/`
  holds the original challenge files and is read-only.
- Keep your context lean: delegate reviews to the subagent, read logs with `tail`, `jq` and `grep`, and
  never `cat` a whole diff that the reviewer already read.

## Stop and ask the owner

- At every milestone gate (M0 to M5): run `/milestone <M>` and wait for "go". After the go, run
  `wp tag <m> "<message>"`.
- Before:
  - adding a paid service or an account the owner has not set up;
  - a decision that is not in the PRD or an ADR and is costly to reverse;
  - deleting data or rewriting history;
  - changing the PRD;
  - anything irreversible.
- When a WP has used all attempts, or a worker raises a contract change request that changes
  user-visible behaviour.
- After WP-002 lands: ask the owner to run
  `gh variable set ALLOWED_AUTHOR_EMAIL --body "$(git config user.email)"` and `orchestration/bin/wp protect`.
- When `wp doctor` fails, or a credential, permission (macOS TCC) or GitHub setting is missing.

Within a wave, act autonomously: run, verify, review, commit, open PRs and land without asking.

## Orchestrator-only changes

Briefs, templates, config and ADR index changes also go through a PR:

1. `wp orch <slug>` creates a worktree on `chore/orch-<slug>`.
2. Edit the files there and commit (for example `chore(orchestration): add W1 briefs`).
3. `wp verify orch-<slug>`, `wp pr orch-<slug>`, `wp land orch-<slug>`.

## Writing a brief (W1 and later)

Use `orchestration/templates/brief.md`. A good brief:

- covers one lane and one package area;
- is expected to change at most about 800 lines;
- lists exact `owns` paths that do not overlap with parallel WPs;
- names the PRD sections and FR/NFR IDs;
- states acceptance criteria that tests can prove against real services;
- has gates that run in under about five minutes, and a Conventional `pr_title`;
- sets `risk: high` for approvals, guards, the safety net, bridge security, auth and data deletion.

Prefer more, smaller WPs over one large one; the data fan-out (one benefit per WP) can run up to
`MAX_PARALLEL` at once.

## Milestone report (what `/milestone` produces)

- WPs landed (with PR links), WPs still open, and gate results with exact commands.
- Evaluation numbers available so far.
- Deviations from the PRD and ADRs written.
- Open contract change requests and follow-ups.
- Risks.
- Token usage per WP (`wp status`).
- The proposed next wave with its first batch.
