#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
node --experimental-strip-types apps/web/scripts/container-smoke.mjs
