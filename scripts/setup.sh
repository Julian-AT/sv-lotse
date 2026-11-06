#!/usr/bin/env bash
# setup: one-time machine and repository setup for the owner. Safe to re-run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
ENV_FILE="$ROOT/.env.local"
EXAMPLE="$ROOT/.env.example"

die()  { printf '\033[31msetup: %s\033[0m\n' "$*" >&2; exit 1; }
step() { printf '\033[1m==> %s\033[0m\n' "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }

brew_need() {
  local cmd="$1" formula="$2"
  have "$cmd" || brew install "$formula"
}

version_at_least() {
  local have_v="$1" need_v="$2"
  [ "$(printf '%s\n%s\n' "$need_v" "$have_v" | sort -V | head -n 1)" = "$need_v" ]
}

install_tools() {
  step "tools"
  have brew || die "install Homebrew first: https://brew.sh"
  xcodebuild -version >/dev/null 2>&1 || die "install Xcode from the App Store, then: sudo xcode-select -s /Applications/Xcode.app"

  if ! have node || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    brew install node@22
    PATH="$(brew --prefix node@22)/bin:$PATH"
    # shellcheck disable=SC2016
    printf 'add to your shell profile: export PATH="%s/bin:$PATH"\n' "$(brew --prefix node@22)"
  fi

  have bun || brew install oven-sh/bun/bun
  if ! version_at_least "$(bun --version)" 1.4.0; then
    case "$(command -v bun)" in
      "$HOME/.bun/"*) bun upgrade ;;
      *) brew upgrade oven-sh/bun/bun ;;
    esac
  fi

  have docker || brew install --cask orbstack
  brew_need jq jq
  brew_need gh gh
  brew_need xcodegen xcodegen
  brew_need swiftlint swiftlint
  brew_need gitleaks gitleaks
  brew_need actionlint actionlint
}


env_get() {
  awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$ENV_FILE"
}

env_set() {
  local tmp="$ENV_FILE.tmp"
  K="$1" V="$2" awk 'index($0, ENVIRON["K"] "=") == 1 { print ENVIRON["K"] "=" ENVIRON["V"]; next } { print }' \
    "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}

fill_env() {
  local line key secret value
  step ".env.local"
  [ -f "$ENV_FILE" ] || : > "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    grep -q "^$key=" "$ENV_FILE" || printf '%s\n' "$line" >> "$ENV_FILE"
  done < "$EXAMPLE"

  if [ -z "$(env_get OPENAI_API_KEY)" ]; then
    read -rsp "OpenAI API key (input hidden): " value
    printf '\n'
    [ -n "$value" ] || die "OPENAI_API_KEY is required"
    env_set OPENAI_API_KEY "$value"
  fi

  for secret in SESSION_SECRET APPROVAL_HMAC_SECRET CRON_SECRET; do
    [ -n "$(env_get "$secret")" ] || env_set "$secret" "$(openssl rand -base64 48 | tr -d '\n')"
  done

}

install_tools
step "bun install"
(cd "$ROOT" && bun install --frozen-lockfile)
fill_env
step "done"
printf 'next: docker compose up -d, then see README "Setup"\n'
