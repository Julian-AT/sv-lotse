"""Smoke run: short LoRA SFT, then the plan proxy eval for base and fine-tune on the same personas.

    uv run --extra train python -m sft.smoke --config sft/configs/qwen3-8b-smoke.yaml --n-eval 200

Writes results/sft-smoke-<gitsha>.json with the train record and both eval summaries. Each step
runs as its own process so GPU memory is released between training and generation.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import yaml

from sft.results import ML_ROOT, RESULTS_DIR, git_sha, write_result


def run(cmd: list[str], env_gpu: str | None) -> None:
    import os

    env = {**os.environ, **({"CUDA_VISIBLE_DEVICES": env_gpu} if env_gpu else {})}
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, cwd=ML_ROOT, check=True, env=env)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, default=Path("sft/configs/qwen3-8b-smoke.yaml"))
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--n-eval", type=int, default=200)
    ap.add_argument("--split", default="test")
    ap.add_argument("--gpu", default="0")
    ap.add_argument("--eval-gpus", default=None, help="run base eval on these GPUs in parallel")
    args = ap.parse_args()

    cfg = yaml.safe_load((ML_ROOT / args.config).read_text())
    sha = git_sha()
    tag = f"sft-smoke-{sha}"
    py = sys.executable
    personas = cfg["data"]["personas"]
    t0 = time.time()

    base_eval = [
        py, "-m", "eval.plan_eval", "--model", cfg["model"], "--personas", personas,
        "--split", args.split, "--n", str(args.n_eval), "--run", f"{tag}-eval-base",
        "--samples-out", f"results/samples/{tag}-base.jsonl",
    ]  # fmt: skip
    base_proc = None
    if args.eval_gpus:  # base eval does not depend on training: run it on another GPU meanwhile
        import os

        env = {**os.environ, "CUDA_VISIBLE_DEVICES": args.eval_gpus}
        base_proc = subprocess.Popen(base_eval, cwd=ML_ROOT, env=env)

    overrides = [f"--set=run={tag}-train", *(f"--set={s}" for s in args.set)]
    run([py, "-m", "sft.train", "--config", str(args.config), *overrides], args.gpu)
    adapter = f"checkpoints/{tag}-train"
    run(
        [
            py,
            "-m",
            "eval.plan_eval",
            "--model",
            cfg["model"],
            "--adapter",
            adapter,
            "--personas",
            personas,
            "--split",
            args.split,
            "--n",
            str(args.n_eval),
            "--run",
            f"{tag}-eval-sft",
            "--samples-out",
            f"results/samples/{tag}-sft.jsonl",
        ],  # fmt: skip
        args.gpu,
    )
    if base_proc is not None:
        if base_proc.wait() != 0:
            raise SystemExit("base eval failed")
    else:
        run(base_eval, args.gpu)

    parts = {
        k: json.loads((RESULTS_DIR / f"{tag}-{k}.json").read_text())
        for k in ("train", "eval-base", "eval-sft")
    }
    base_m, sft_m = parts["eval-base"]["metrics"], parts["eval-sft"]["metrics"]
    record = {
        "stage": "sft_smoke",
        "note": (
            "Smoke run of the SFT pipeline. Eval is the single-turn plan proxy (eval/plan_eval.py),"
            " not the multi-turn AT-Benefits gym; numbers are not paper results."
        ),
        "config": parts["train"]["config"],
        "data": parts["train"]["data"],
        "train_metrics": parts["train"]["metrics"],
        "loss_history": parts["train"]["loss_history"],
        "eval": {
            "split": args.split,
            "n": base_m["n"],
            "persona_data_hash": parts["eval-base"]["data_hash"],
            "base": base_m,
            "sft": sft_m,
            "delta_mean_reward": round(sft_m["mean_reward"] - base_m["mean_reward"], 4),
        },
        "wall_seconds_total": round(time.time() - t0, 1),
    }
    print(write_result(tag, record))


if __name__ == "__main__":
    main()
