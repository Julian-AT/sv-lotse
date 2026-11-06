#!/usr/bin/env bash
# Train, evaluate and publish the SV-Lotse SFT model on a remote GPU box (3×H100) over SSH.
#
#   ml/remote/run.sh [--merged] [--no-wait] [--config sft/configs/qwen3-8b-sft.yaml] \
#       [--n-eval 200] user@host
#
# 1. rsyncs the ml/ code (no data, venv, checkpoints or results) to ~/lotse-ml and writes GIT_SHA;
# 2. starts ml/remote/pipeline.sh in tmux session `lotse` (gpu check, uv + torch for the driver's
#    CUDA, HF data, SFT on all GPUs, plan eval base vs fine-tuned, optional merge); every stage is
#    resumable, logs are in ~/lotse-ml/logs/;
# 3. waits for logs/DONE (skip with --no-wait; rerun the same command later to continue);
# 4. copies results/ and the LoRA adapter back to ml/results and ml/checkpoints/<run>;
# 5. publishes to Hugging Face with publish.model.
#
# HF token: by default the model is published FROM THIS MAC (adapter + card + results); the token
# never leaves the machine and publish.model reads .env.local in-process. With --merged the merged
# bf16 weights (~16 GB) are uploaded from the box: the token is read from .env.local here and
# streamed over the SSH connection's stdin into that one process (never on a command line, in a
# file, a log or tmux on the box).
#
# Env: SSH_OPTS (e.g. "-p 2222 -i ~/.ssh/h100"), TRAIN_SET ("max_length=16384 train.epochs=1"),
#      FLASH_ATTN=1, EVAL_BACKEND=transformers|vllm, ENV_FILE (default: <repo>/.env.local).
set -euo pipefail

ML="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$ML/.." && pwd)"
CONFIG=sft/configs/qwen3-8b-sft.yaml
N_EVAL=200
MERGED=0
WAIT=1
HOST=""
while (($#)); do
  case $1 in
    --merged) MERGED=1 ;;
    --no-wait) WAIT=0 ;;
    --config) CONFIG=$2; shift ;;
    --n-eval) N_EVAL=$2; shift ;;
    -h | --help) sed -n '2,25p' "$0"; exit 0 ;;
    *) HOST=$1 ;;
  esac
  shift
done
[[ -n "$HOST" ]] || { echo "usage: $0 [--merged] [--no-wait] [--config C] [--n-eval N] user@host" >&2; exit 2; }
[[ -f "$ML/$CONFIG" ]] || { echo "config not found: $ML/$CONFIG" >&2; exit 2; }
ENV_FILE=${ENV_FILE:-$REPO/.env.local}
RUN=$(awk '/^run:/{print $2; exit}' "$ML/$CONFIG")
# shellcheck disable=SC2206
SSH=(ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 ${SSH_OPTS:-})
RSYNC_E="ssh -o StrictHostKeyChecking=accept-new ${SSH_OPTS:-}"
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

log "sync ml/ -> $HOST:~/lotse-ml (run $RUN)"
rsync -az --delete -e "$RSYNC_E" \
  --exclude /.venv/ --exclude /data/ --exclude /checkpoints/ --exclude /results/ \
  --exclude /logs/ --exclude /GIT_SHA --exclude __pycache__/ --exclude .pytest_cache/ \
  --exclude .ruff_cache/ --exclude '*.parquet' "$ML/" "$HOST:lotse-ml/"
git -C "$REPO" rev-parse --short HEAD | "${SSH[@]}" "$HOST" 'cat > lotse-ml/GIT_SHA'

remote_env=$(printf 'TRAIN_SET=%q FLASH_ATTN=%q EVAL_BACKEND=%q' \
  "${TRAIN_SET:-}" "${FLASH_ATTN:-0}" "${EVAL_BACKEND:-}")
cmd="cd ~/lotse-ml && mkdir -p logs && env $remote_env bash remote/pipeline.sh $(printf %q "$CONFIG") $N_EVAL $MERGED 2>&1 | tee -a logs/pipeline.log"
log "start pipeline (tmux session lotse)"
"${SSH[@]}" "$HOST" bash -s -- "$(printf %q "$cmd")" <<'REMOTE'
set -e
cmd=$1
if [ -f ~/lotse-ml/logs/DONE ] && [ ! -f ~/lotse-ml/logs/FAILED ]; then echo "pipeline already done"; exit 0; fi
if ! command -v tmux >/dev/null; then
  (sudo -n apt-get install -y -qq tmux || sudo -n yum install -y -q tmux) >/dev/null 2>&1 || true
fi
if command -v tmux >/dev/null; then
  if tmux has-session -t lotse 2>/dev/null; then echo "pipeline already running in tmux"; exit 0; fi
  tmux new-session -d -s lotse "bash -lc $(printf %q "$cmd")"
  echo "started in tmux session lotse"
else
  nohup setsid bash -lc "$cmd" >/dev/null 2>&1 < /dev/null &
  echo "tmux unavailable: started with nohup"
fi
REMOTE

if ((WAIT == 0)); then
  log "not waiting; follow with: ml/remote/status.sh $HOST; rerun this command to fetch and publish"
  exit 0
fi

log "waiting for the pipeline (status: ml/remote/status.sh $HOST)"
while true; do
  state=$("${SSH[@]}" "$HOST" 'cd ~/lotse-ml/logs 2>/dev/null && { [ -f FAILED ] && echo failed; [ -f DONE ] && echo done; ls *.done 2>/dev/null | tr "\n" " "; }' || echo "ssh-error")
  case $state in
    failed*) log "pipeline FAILED"; "${SSH[@]}" "$HOST" 'cat ~/lotse-ml/logs/FAILED; tail -n 40 ~/lotse-ml/logs/pipeline.log'; exit 1 ;;
    done*) log "pipeline done"; break ;;
    *) log "stages done: ${state:-none}" ;;
  esac
  sleep 120
done

fetch() {
  mkdir -p "$ML/results" "$ML/checkpoints/$RUN"
  rsync -az -e "$RSYNC_E" "$HOST:lotse-ml/results/" "$ML/results/"
  rsync -az -e "$RSYNC_E" --exclude 'checkpoint-*/' "$HOST:lotse-ml/checkpoints/$RUN/" "$ML/checkpoints/$RUN/"
  rsync -az -e "$RSYNC_E" "$HOST:lotse-ml/logs/" "$ML/results/remote-logs/$RUN/"
}
log "fetch results/ and the adapter"
fetch

if ((MERGED == 1)); then
  log "publish adapter + merged weights from the box (token via SSH stdin)"
  [[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }
  sed -n 's/^HF_TOKEN=//p' "$ENV_FILE" | tail -n1 | tr -d "\"'\r" | "${SSH[@]}" "$HOST" \
    "IFS= read -r HF_TOKEN && export HF_TOKEN && cd ~/lotse-ml && .venv/bin/python -m publish.model --config $(printf %q "$CONFIG") --merged" \
    | tee -a "$ML/results/remote-logs/$RUN/publish.log"
  fetch
else
  log "publish adapter from this Mac"
  (cd "$ML" && uv run python -m publish.model --config "$CONFIG" --env-file "$ENV_FILE")
fi
log "done: results in ml/results/$RUN*.json"
