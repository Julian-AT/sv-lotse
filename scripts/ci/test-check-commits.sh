#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
check_script="$script_dir/check-commits.sh"
test_repo="$(mktemp -d "$script_dir/.test-check-commits.XXXXXX")"
trap 'rm -rf -- "$test_repo"' EXIT

# All Git writes in this test are confined to the disposable repository.
unset GIT_DIR GIT_COMMON_DIR GIT_WORK_TREE GIT_INDEX_FILE
git -C "$test_repo" init --quiet
tree="$(git -C "$test_repo" hash-object -w -t tree --stdin < /dev/null)"
allowed_email='owner@example.invalid'
policy_email="$allowed_email"
passed=0

new_commit() {
  local message="$1" author="$2" committer="$3"
  shift 3
  GIT_AUTHOR_NAME='CI policy test' GIT_AUTHOR_EMAIL="$author" \
    GIT_COMMITTER_NAME='CI policy test' GIT_COMMITTER_EMAIL="$committer" \
    GIT_AUTHOR_DATE='2026-01-01T00:00:00Z' GIT_COMMITTER_DATE='2026-01-01T00:00:00Z' \
    git -C "$test_repo" -c commit.gpgSign=false commit-tree "$tree" "$@" <<< "$message"
}

expect_pass() {
  local name="$1" output
  shift
  if ! output="$(cd -- "$test_repo" && ALLOWED_AUTHOR_EMAIL="$policy_email" bash "$check_script" "$@" 2>&1)"; then
    printf 'FAIL: %s\n%s\n' "$name" "$output" >&2
    exit 1
  fi
  printf 'PASS: %s\n' "$name"
  passed=$((passed + 1))
}

expect_fail() {
  local name="$1" expected="$2" output
  shift 2
  if output="$(cd -- "$test_repo" && ALLOWED_AUTHOR_EMAIL="$policy_email" bash "$check_script" "$@" 2>&1)"; then
    printf 'FAIL: %s was accepted\n' "$name" >&2
    exit 1
  fi
  if ! printf '%s\n' "$output" | grep -Eq -- "$expected"; then
    printf 'FAIL: %s failed for the wrong reason\n%s\n' "$name" "$output" >&2
    exit 1
  fi
  printf 'PASS: %s\n' "$name"
  passed=$((passed + 1))
}

legacy="$(new_commit 'initial repository before the commit policy' 'legacy@example.invalid' 'legacy@example.invalid')"
good="$(new_commit 'ci(repo): enforce commit policy' "$allowed_email" "$allowed_email" -p "$legacy")"
next="$(new_commit $'test(ci): cover valid commit ranges\n\nKeep legacy history outside the checked range.' "$allowed_email" "$allowed_email" -p "$good")"
expect_pass 'AC2 good commit excludes legacy history' "$legacy" "$good"
expect_pass 'AC2 all good commits in a range pass' "$legacy" "$next"
expect_pass 'AC2 empty range passes' "$good" "$good"
expect_pass 'AC2 first push checks only its head' '0000000000000000000000000000000000000000' "$next"

wrong_author="$(new_commit 'ci(repo): check author identity' 'other@example.invalid' "$allowed_email" -p "$good")"
expect_fail 'AC2 wrong author fails' 'author email must equal ALLOWED_AUTHOR_EMAIL' "$good" "$wrong_author"
wrong_committer="$(new_commit 'ci(repo): check committer identity' "$allowed_email" 'other@example.invalid' -p "$good")"
expect_fail 'AC2 wrong committer fails' 'committer email must equal ALLOWED_AUTHOR_EMAIL' "$good" "$wrong_committer"
bad_header="$(new_commit 'update the pipeline' "$allowed_email" "$allowed_email" -p "$good")"
expect_fail 'AC2 bad header fails' 'subject-empty|type-empty' "$good" "$bad_header"
bad_scope="$(new_commit 'ci(unknown): check scope policy' "$allowed_email" "$allowed_email" -p "$good")"
expect_fail 'AC2 unlisted scope fails' 'scope-enum' "$good" "$bad_scope"
trailer_key="Co-authored""-by"
coauthor="$(new_commit $'ci(repo): check attribution\n\n'"${trailer_key}: Helper <helper@example.invalid>" "$allowed_email" "$allowed_email" -p "$good")"
expect_fail 'AC2 co-author trailer fails' 'no-ai-attribution' "$good" "$coauthor"
attribution="$(new_commit $'ci(repo): check generated attribution\n\nGenerated with Codex' "$allowed_email" "$allowed_email" -p "$good")"
expect_fail 'AC2 AI attribution fails' 'no-ai-attribution' "$good" "$attribution"
side="$(new_commit 'test(ci): exercise a second parent' "$allowed_email" "$allowed_email" -p "$good")"
merge="$(new_commit 'ci(repo): combine histories' "$allowed_email" "$allowed_email" -p "$next" -p "$side")"
expect_fail 'AC2 merge commit with a valid header fails' 'merge commits are not allowed' "$good" "$merge"
fixup="$(new_commit 'fixup! ci(repo): enforce commit policy' "$allowed_email" "$allowed_email" -p "$good")"
expect_fail 'AC2 fixup commit fails' 'fixup commits are not allowed' "$good" "$fixup"
squash="$(new_commit 'squash! ci(repo): enforce commit policy' "$allowed_email" "$allowed_email" -p "$good")"
expect_fail 'AC2 squash commit fails' 'fixup commits are not allowed' "$good" "$squash"
version="$(new_commit 'v1.2.3' "$allowed_email" "$allowed_email" -p "$good")"
expect_fail 'AC2 commitlint default ignores cannot bypass policy' 'subject-empty|type-empty' "$good" "$version"
expect_fail 'AC2 first push still rejects a bad header' 'subject-empty|type-empty' '0000000000000000000000000000000000000000' "$bad_header"
expect_fail 'AC2 invalid base fails closed' 'base must identify a commit' 'not-a-revision' "$good"
expect_fail 'AC2 invalid head fails closed' 'head must identify a commit' "$good" 'not-a-revision'
expect_fail 'AC2 missing arguments fail' 'Usage:'
policy_email=''
expect_fail 'AC2 missing allowed identity fails closed' 'ALLOWED_AUTHOR_EMAIL must be set' "$legacy" "$good"

printf '%s commit policy tests passed.\n' "$passed"
