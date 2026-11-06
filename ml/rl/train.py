"""Launch verl multi-turn GRPO from rl/grpo-*.yaml (lotse-rl.md §7.1, S3).

    uv run python -m rl.train --config rl/grpo-a3b.yaml [--dry-run]

Flattens the ``verl`` block into Hydra overrides for the configured verl entry point and pins
the GPU layout: the simulator vLLM server on GPU 0, the policy rollout on GPU 0,
the actor on GPUs 1-2.
verl is installed on the GPU box only (``uv pip install verl[vllm]``), not in the lock file.
"""

from __future__ import annotations

import argparse
import os
import shlex
import subprocess
from pathlib import Path
from typing import Any

import yaml


def flatten(node: Any, prefix: str = "") -> list[str]:
    if isinstance(node, dict):
        return [o for k, v in node.items() for o in flatten(v, f"{prefix}{k}.")]
    value = yaml.safe_dump(node, default_flow_style=True).strip().removesuffix("...").strip()
    return [f"{prefix[:-1]}={value}"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", type=Path, required=True)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    cfg = yaml.safe_load(args.config.read_text())
    overrides = [o.replace("${policy}", cfg["policy"]) for o in flatten(cfg["verl"])]
    gpus = cfg["layout"]["rollout_gpus"] + cfg["layout"]["actor_gpus"]
    env = {**os.environ, "CUDA_VISIBLE_DEVICES": ",".join(map(str, sorted(set(gpus))))}
    entry = cfg.get("entrypoint", "verl.trainer.main_ppo")
    cmd = ["python", "-m", entry, *overrides]
    print(shlex.join(cmd))
    if not args.dry_run:
        subprocess.run(cmd, check=True, env=env)


if __name__ == "__main__":
    main()
