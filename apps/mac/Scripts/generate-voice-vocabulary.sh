#!/bin/bash
set -euo pipefail

# Source-backed vocabulary is owned by knowledge; SwiftPM bundles an exact generated copy.
repository_root="$(cd "$(dirname "$0")/../../.." && pwd)"
resource_dir="$repository_root/apps/mac/Packages/LotseKit/Sources/LotseVoice/Resources"
mkdir -p "$resource_dir"
cp "$repository_root/packages/knowledge/data/voice-vocabulary.json" "$resource_dir/voice-vocabulary.json"
