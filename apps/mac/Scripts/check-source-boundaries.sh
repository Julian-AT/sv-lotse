#!/bin/bash
set -euo pipefail

mac_root="$(cd "$(dirname "$0")/.." && pwd)"
source_paths=("$mac_root/App" "$mac_root/Packages/LotseKit/Sources")
pattern='assemblyai|workers\.dev|cloudflare|api\.anthropic\.com|anthropic|us\.i\.posthog\.com|\[POINT:|/api/turn|@unchecked[[:space:]]+Sendable'

if rg --ignore-case --line-number "$pattern" "${source_paths[@]}"; then
    echo "Forbidden client integration found in Mac product sources." >&2
    exit 1
else
    result=$?
    if [[ "$result" -ne 1 ]]; then exit "$result"; fi
fi
echo "Mac source boundaries passed."
