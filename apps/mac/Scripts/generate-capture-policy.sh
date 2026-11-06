#!/bin/bash
set -euo pipefail

# The knowledge package owns the source policy. SwiftPM bundles an exact generated copy.
repository_root="$(cd "$(dirname "$0")/../../.." && pwd)"
policy_source="$repository_root/packages/knowledge/privacy/screen-capture-exclusions.json"
policy_resource="$repository_root/apps/mac/Packages/LotseKit/Sources/LotseCapture/Resources/screen-capture-exclusions.json"
cp "$policy_source" "$policy_resource"
