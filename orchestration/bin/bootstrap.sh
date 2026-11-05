#!/usr/bin/env bash
# One-time setup of the SV KI-Lotse repository from the kit.
#
#   bash orchestration/bin/bootstrap.sh                      # local repository only
#   bash orchestration/bin/bootstrap.sh --github sv-ki-lotse # also create a private GitHub repo and push
#
# Creates the repository, installs the commit-policy hooks, records you as the
# only allowed author, makes the first commit and (optionally) the GitHub repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
cd "$ROOT"

repo_name=""
visibility="--private"
while [ $# -gt 0 ]; do
  case "$1" in
    --github) repo_name="${2:?--github needs a repository name}"; shift 2 ;;
    --public) visibility="--public"; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

need() { command -v "$1" >/dev/null 2>&1 || { echo "bootstrap: $1 is required ($2)" >&2; exit 1; }; }
need git "brew install git"
need jq "brew install jq"

name="$(git config user.name || true)"
email="$(git config user.email || true)"
if [ -z "$name" ] || [ -z "$email" ]; then
  echo "bootstrap: set your identity first:" >&2
  echo "  git config --global user.name  \"Your Name\"" >&2
  echo "  git config --global user.email \"you@example.com\"" >&2
  exit 1
fi

[ -d .git ] || git init -q -b main
chmod +x .githooks/commit-msg .githooks/pre-commit .githooks/pre-push orchestration/bin/wp orchestration/bin/bootstrap.sh

git config core.hooksPath .githooks
git config lotse.authorEmail "$email"
git config lotse.baseBranch main
git config commit.template .gitmessage
git config pull.ff only
git config rebase.autoSquash true
git config push.autoSetupRemote true
git config fetch.prune true
git config init.defaultBranch main

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "bootstrap: created .env.local from .env.example; fill in your keys (never committed)"
fi

if ! git rev-parse --verify -q HEAD >/dev/null; then
  git add -A
  git commit -q -F - <<'MSG'
chore(repo): bootstrap orchestration kit and product requirements

Add the product requirements document, the orchestration playbook, the
work-package pipeline (wp CLI, templates, worker report schema), the W0
work-package briefs, instructions for the orchestrator and the workers,
and the hooks that enforce the commit policy.
MSG
  echo "bootstrap: first commit created as $name <$email>"
fi

if [ -n "$repo_name" ]; then
  need gh "brew install gh && gh auth login"
  gh auth status >/dev/null 2>&1 || { echo "bootstrap: run 'gh auth login' first" >&2; exit 1; }
  if ! git remote get-url origin >/dev/null 2>&1; then
    gh repo create "$repo_name" "$visibility" --source . --remote origin
  fi
  WP_LANDING=1 git push -q -u origin main
  gh variable set ALLOWED_AUTHOR_EMAIL --body "$email" >/dev/null
  gh repo edit --enable-squash-merge=false --enable-merge-commit=false --enable-rebase-merge=true --delete-branch-on-merge >/dev/null || true
  echo "bootstrap: pushed to $(git remote get-url origin)"
fi

cat <<EOF

Next steps
  1. Fill in .env.local (keys stay local; CI secrets go to GitHub Actions secrets).
  2. Set CODEX_MODEL in orchestration/config.env (or .orchestration/config.local.env).
  3. orchestration/bin/wp doctor
  4. Start Claude Code in this folder and run:  /orchestrate W0
EOF
