#!/bin/bash
set -euo pipefail
mac_root="$(cd "$(dirname "$0")/.." && pwd)"
repo_root="$(cd "$mac_root/../.." && pwd)"
destination="$mac_root/Packages/LotseKit/Sources/LotseImport/Resources"
mkdir -p "$destination"
cp "$repo_root/packages/knowledge/guards/mac-capture-exclusions.json" "$destination/mac-capture-exclusions.json"
