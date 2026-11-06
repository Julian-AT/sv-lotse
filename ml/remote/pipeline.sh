#!/usr/bin/env bash
# Runs ON the GPU box inside tmux (started by ml/remote/run.sh). Do not run it on the Mac.
#   bash ~/lotse-ml/remote/pipeline.sh <config> <n_eval> <merged 0|1>
# Stages: gpu -> setup -> data -> train -> eval -> merge (optional). Each stage writes
# logs/<stage>.done when it succeeds and is skipped on a rerun; training resumes from its last
# LoRA checkpoint. logs/DONE marks success, logs/FAILED a failure (with the stage name).
# Env: TRAIN_SET="key=value ..." (sft.train --set overrides), FLASH_ATTN=1 (try to install
# flash-attn; otherwise sdpa), EVAL_BACKEND=transformers|vllm (default: vllm if importable).
set -euo pipefail
CONFIG=${1:-sft/configs/qwen3-8b-sft.yaml}
N_EVAL=${2:-200}
MERGED=${3:-0}
ROOT="$HOME/lotse-ml"
cd "$ROOT"
mkdir -p logs results/samples
rm -f logs/FAILED logs/DONE
export PATH="$HOME/.local/bin:$PATH" TOKENIZERS_PARALLELISM=false PYTHONUNBUFFERED=1
PY="$ROOT/.venv/bin/python"
CURRENT=""
trap 'echo "${CURRENT:-?} failed at $(date -Is)" > logs/FAILED' ERR

stage() {
  local name=$1
  shift
  if [[ -f "logs/$name.done" ]]; then
    echo "== skip $name (done)"
    return 0
  fi
  CURRENT=$name
  echo "== $name start $(date -Is)"
  "$@" 2>&1 | tee -a "logs/$name.log"
  touch "logs/$name.done"
  echo "== $name done $(date -Is)"
}

stage_gpu() {
  nvidia-smi
  nvidia-smi | sed -n 's/.*CUDA Version: *\([0-9][0-9.]*\).*/\1/p' | head -n1 > logs/cuda_driver
  nvidia-smi -L | wc -l | tr -d ' ' > logs/ngpu
  echo "driver CUDA $(cat logs/cuda_driver), GPUs $(cat logs/ngpu)"
  df -h "$HOME" | tail -n1
}

torch_ok() {
  "$PY" - <<'PY'
import sys, torch
ok = torch.cuda.is_available() and torch.cuda.device_count() > 0
print("torch", torch.__version__, "cuda", torch.version.cuda, "available", ok, "devices",
      torch.cuda.device_count())
if ok:
    torch.ones(1, device="cuda").add_(1)
sys.exit(0 if ok else 1)
PY
}

torch_backend() {  # driver CUDA -> PyTorch wheel index
  local v major minor
  v=$(cat logs/cuda_driver)
  major=${v%%.*}
  minor=${v#*.}
  minor=${minor%%.*}
  if ((major >= 13)); then echo cu130
  elif ((major == 12 && minor >= 8)); then echo cu128
  elif ((major == 12 && minor >= 6)); then echo cu126
  else echo cu124
  fi
}

stage_setup() {
  command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh
  command -v uv
  uv sync --extra train
  if ! torch_ok; then
    local backend version
    backend=$(torch_backend)
    version=$("$PY" -c "import torch; print(torch.__version__.split('+')[0])")
    echo "PyPI torch does not run on driver CUDA $(cat logs/cuda_driver): reinstalling for $backend"
    uv pip install --python "$PY" --reinstall-package torch --torch-backend "$backend" \
      "torch==$version" || uv pip install --python "$PY" --reinstall-package torch \
      --torch-backend "$backend" torch
    torch_ok
  fi
  if [[ "${FLASH_ATTN:-0}" == 1 ]]; then
    timeout 1800 uv pip install --python "$PY" flash-attn --no-build-isolation \
      || echo "flash-attn not installed: training uses sdpa"
  fi
  "$PY" -c "import transformers, peft, trl, accelerate; print('transformers', transformers.__version__, 'peft', peft.__version__, 'trl', trl.__version__)"
}

cfg() { "$PY" -c "import yaml, sys; print(yaml.safe_load(open('$CONFIG'))[sys.argv[1]])" "$1"; }

SETS=()
for s in ${TRAIN_SET:-}; do SETS+=(--set "$s"); done

stage_data() {
  "$PY" -m sft.train --config "$CONFIG" --dry-run --check-data --set "num_gpus=$NGPU" ${SETS[@]+"${SETS[@]}"}
  "$PY" -c "from huggingface_hub import snapshot_download as s; print(s('$MODEL', allow_patterns=['*.json', '*.safetensors', '*.txt', '*.jinja']))"
  "$PY" -c "from sft.data import load_hf_personas as l; print(len(l('test', $N_EVAL)[0]), 'test personas')"
}

stage_train() {
  if ((NGPU > 1)); then
    "$ROOT/.venv/bin/accelerate" launch --config_file sft/configs/accelerate-ddp.yaml \
      --num_processes "$NGPU" -m sft.train --config "$CONFIG" ${SETS[@]+"${SETS[@]}"}
  else
    "$PY" -m sft.train --config "$CONFIG" ${SETS[@]+"${SETS[@]}"}
  fi
  test -f "results/$RUN.json"
}

eval_one() {  # tag gpu [--adapter dir]
  local tag=$1 gpu=$2
  shift 2
  [[ -f "results/$RUN-eval-$tag.json" ]] && return 0
  CUDA_VISIBLE_DEVICES=$gpu "$PY" -m eval.plan_eval --model "$MODEL" --personas hf --split test \
    --n "$N_EVAL" --backend "$BACKEND" --run "$RUN-eval-$tag" \
    --samples-out "results/samples/$RUN-$tag.jsonl" "$@" > "logs/eval-$tag.log" 2>&1
}

stage_eval() {
  BACKEND=${EVAL_BACKEND:-$("$PY" -c "import vllm" 2>/dev/null && echo vllm || echo transformers)}
  echo "eval backend: $BACKEND, n=$N_EVAL"
  local second=0
  ((NGPU > 1)) && second=1
  eval_one base 0 &
  local p_base=$!
  eval_one sft "$second" --adapter "checkpoints/$RUN" &
  local p_sft=$!
  wait "$p_base"
  wait "$p_sft"
  "$PY" - "$RUN" <<'PY'
import json, sys
run = sys.argv[1]
for tag in ("base", "sft"):
    m = json.load(open(f"results/{run}-eval-{tag}.json"))["metrics"]
    print(tag, {k: m.get(k) for k in ("n", "mean_reward", "reward_ci95", "mean_no_plan")})
PY
}

stage_merge() { "$PY" -m publish.model --config "$CONFIG" --merge-only; }

stage gpu stage_gpu
NGPU=$(cat logs/ngpu)
stage setup stage_setup
RUN=$(cfg run)
MODEL=$(cfg model)
echo "run $RUN, model $MODEL, git $(cat GIT_SHA 2>/dev/null || echo unknown)"
stage data stage_data
stage train stage_train
stage eval stage_eval
[[ "$MERGED" == 1 ]] && stage merge stage_merge
CURRENT=""
date -Is > logs/DONE
echo "== pipeline done"
