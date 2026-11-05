#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo 'Usage: check-commits.sh <base> <head> (use an all-zero base for a first push)' >&2
  exit 1
fi
if [[ -z "${ALLOWED_AUTHOR_EMAIL:-}" ]]; then
  echo 'check-commits: ALLOWED_AUTHOR_EMAIL must be set to the permitted identity' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
base="$1"
if ! head="$(git rev-parse --verify --end-of-options "$2^{commit}" 2>/dev/null)"; then
  echo 'check-commits: head must identify a commit' >&2
  exit 1
fi

first_push=false
if [[ "$base" =~ ^0{40}$|^0{64}$ ]]; then
  first_push=true
  commits="$head"
else
  if ! base="$(git rev-parse --verify --end-of-options "$base^{commit}" 2>/dev/null)"; then
    echo 'check-commits: base must identify a commit' >&2
    exit 1
  fi
  commits="$(git rev-list "$base..$head")"
fi
if [[ -z "$commits" ]]; then
  echo 'check-commits: no commits in the selected range'
  exit 0
fi

failed=0
while IFS= read -r commit; do
  [[ -n "$commit" ]] || continue
  if [[ "$(git show -s --format=%ae "$commit")" != "$ALLOWED_AUTHOR_EMAIL" ]]; then
    printf 'check-commits: %s: author email must equal ALLOWED_AUTHOR_EMAIL\n' "$commit" >&2
    failed=1
  fi
  if [[ "$(git show -s --format=%ce "$commit")" != "$ALLOWED_AUTHOR_EMAIL" ]]; then
    printf 'check-commits: %s: committer email must equal ALLOWED_AUTHOR_EMAIL\n' "$commit" >&2
    failed=1
  fi
  if [[ "$(git show -s --format=%P "$commit")" == *' '* ]]; then
    printf 'check-commits: %s: merge commits are not allowed\n' "$commit" >&2
    failed=1
  fi
  if [[ "$(git show -s --format=%s "$commit")" =~ ^(fixup!|squash!|amend!) ]]; then
    printf 'check-commits: %s: fixup commits are not allowed\n' "$commit" >&2
    failed=1
  fi
done <<< "$commits"
if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

if [[ "$first_push" == true ]]; then
  # A new ref can point into legacy history. Check only the pushed head.
  git show -s --format=%B "$head" | bunx commitlint --config "$script_dir/commitlint.config.mjs"
else
  bunx commitlint --from "$base" --to "$head" --config "$script_dir/commitlint.config.mjs"
fi
