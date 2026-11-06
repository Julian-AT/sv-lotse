#!/usr/bin/env bash
# Progress of the remote pipeline: ml/remote/status.sh user@host [-f]  (-f follows the log)
set -euo pipefail
HOST=${1:?usage: $0 user@host [-f]}
# shellcheck disable=SC2206
SSH=(ssh -o StrictHostKeyChecking=accept-new ${SSH_OPTS:-})
if [[ "${2:-}" == -f ]]; then
  exec "${SSH[@]}" -t "$HOST" 'tail -n 50 -F ~/lotse-ml/logs/pipeline.log'
fi
"${SSH[@]}" "$HOST" 'bash -s' <<'REMOTE'
cd ~/lotse-ml/logs 2>/dev/null || { echo "no ~/lotse-ml/logs yet"; exit 0; }
echo "stages done: $(ls *.done 2>/dev/null | sed 's/\.done//' | tr '\n' ' ')"
[ -f FAILED ] && echo "FAILED: $(cat FAILED)"
[ -f DONE ] && echo "DONE at $(cat DONE)"
if command -v tmux >/dev/null && tmux has-session -t lotse 2>/dev/null; then echo "tmux: running"; else echo "tmux: not running"; fi
nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total --format=csv,noheader 2>/dev/null
echo "--- train progress"
grep -aoE "\{'loss'[^}]*\}|[0-9]+/[0-9]+ \[[0-9:]+<[0-9:]+" train.log 2>/dev/null | tail -n 3
echo "--- pipeline.log"
tail -n 15 pipeline.log 2>/dev/null
REMOTE
