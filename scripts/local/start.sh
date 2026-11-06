#!/usr/bin/env bash
# Runs the full local stack on http://localhost:3000 for the Mac app: a dedicated database, the
# catalog, the scenario sources, the demo seed, a production build and `next start` in the
# background. Idempotent: rerunning migrates, reloads, rebuilds and restarts.
# LOTSE_LOCAL_SKIP_BUILD=1 restarts the existing build.
#
# Secrets stay out of the repository. `.env.local` (repository root) is loaded by the app itself;
# values exported here win over it. An optional provider file (LOTSE_PROVIDER_ENV_FILE) may define
# OPENAI_BASE_URL/OPENAI_API_KEY or DATAGEN_OPENAI_BASE_URL/DATAGEN_OPENAI_API_KEY for an
# OpenAI-compatible endpoint. Its values are never printed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="${LOTSE_LOCAL_LOG:-$ROOT/../sv-lotse-local.log}"
PID_FILE="${LOTSE_LOCAL_PID_FILE:-$ROOT/../sv-lotse-local.pid}"
PORT="${PORT:-3000}"
PROVIDER_FILE="${LOTSE_PROVIDER_ENV_FILE:-$HOME/.claude/jobs/a3250876/tmp/datagen.env}"
DATABASE_NAME="${LOTSE_LOCAL_DATABASE:-lotse_app}"
# The Compose services belong to the main checkout's project, also when run from a worktree.
COMPOSE=(docker compose -p "${COMPOSE_PROJECT_NAME:-sv-lotse}")

step() { printf '\n==> %s\n' "$1"; }

read_value() { # read_value FILE KEY -> value without surrounding quotes (never echoed to the log)
  local line
  line="$(grep -E "^(export[[:space:]]+)?$2=" "$1" | tail -n 1 || true)"
  line="${line#export }"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

if [[ -f "$PROVIDER_FILE" ]]; then
  base="$(read_value "$PROVIDER_FILE" OPENAI_BASE_URL)"
  [[ -n "$base" ]] || base="$(read_value "$PROVIDER_FILE" DATAGEN_OPENAI_BASE_URL)"
  key="$(read_value "$PROVIDER_FILE" OPENAI_API_KEY)"
  [[ -n "$key" ]] || key="$(read_value "$PROVIDER_FILE" DATAGEN_OPENAI_API_KEY)"
  if [[ -n "$base" && -n "$key" ]]; then
    export OPENAI_BASE_URL="$base" OPENAI_API_KEY="$key"
    step "Using the OpenAI-compatible endpoint from LOTSE_PROVIDER_ENV_FILE"
  fi
  unset base key
fi

# Model ids for the endpoint above; any value already in the environment wins.
# gpt-6-luna with low reasoning effort and at most three agent steps keeps answers fast
# (gpt-6-sol took 32-35 s for a tool turn on the local proxy, gpt-6-luna 13-22 s).
export OPENAI_MODEL_ORCHESTRATOR="${OPENAI_MODEL_ORCHESTRATOR:-gpt-6-luna}"
export OPENAI_REASONING_EFFORT_ORCHESTRATOR="${OPENAI_REASONING_EFFORT_ORCHESTRATOR:-low}"
export LOTSE_AGENT_MAX_STEPS="${LOTSE_AGENT_MAX_STEPS:-3}"
export OPENAI_MODEL_CLASSIFIER="${OPENAI_MODEL_CLASSIFIER:-gpt-6-luna}"
export OPENAI_MODEL_GUARD="${OPENAI_MODEL_GUARD:-gpt-6-luna}"
export OPENAI_MODEL_EXTRACTOR="${OPENAI_MODEL_EXTRACTOR:-gpt-6-luna}"
export OPENAI_MODEL_VISION="${OPENAI_MODEL_VISION:-gpt-6-sol}"
export FORM_VISION_MODEL="${FORM_VISION_MODEL:-$OPENAI_MODEL_VISION}"
export DATABASE_URL="${LOTSE_LOCAL_DATABASE_URL:-postgres://lotse:lotse@127.0.0.1:5432/$DATABASE_NAME}"
export PORT NEXT_TELEMETRY_DISABLED=1
if [[ -z "${SVBOX_DIR:-}" && ! -d "$ROOT/data/svbox" && -d "$ROOT/../sv-lotse/data/svbox" ]]; then
  export SVBOX_DIR="$ROOT/../sv-lotse/data/svbox"
fi

cd "$ROOT"
step "Database $DATABASE_NAME"
if [[ -z "$("${COMPOSE[@]}" ps --status running -q db 2>/dev/null)" ]]; then
  "${COMPOSE[@]}" up -d --wait >/dev/null
fi
if [[ "$("${COMPOSE[@]}" exec -T db psql -U lotse -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'")" != "1" ]]; then
  "${COMPOSE[@]}" exec -T db psql -U lotse -d postgres -c "CREATE DATABASE \"$DATABASE_NAME\""
fi
bun run --filter @lotse/db db:migrate

step "Catalog, form and scenario sources (lexical-only when embeddings are unavailable)"
bun run demo:seed --catalog-only
bun run --filter @lotse/knowledge ingest:pilot || echo "Some pilot pages failed; continuing."

if [[ "${LOTSE_LOCAL_SKIP_BUILD:-0}" != 1 ]]; then
  step "Build"
  bun run --filter @lotse/web build
fi

step "Start on http://localhost:$PORT (log: $LOG)"
if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")" && sleep 2
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT is busy with another process; stop it and rerun." >&2
  exit 1
fi
(cd apps/web && HOSTNAME=127.0.0.1 nohup node scripts/start-standalone.mjs >>"$LOG" 2>&1 &
  echo $! >"$PID_FILE")
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    step "Ready: http://localhost:$PORT (pid $(cat "$PID_FILE"))"
    exit 0
  fi
  sleep 1
done
echo "The server did not become healthy; see $LOG" >&2
exit 1
