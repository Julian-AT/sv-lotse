"""SFT with TRL SFTTrainer (+ PEFT LoRA): loss on assistant and tool-call tokens only.

    uv run --extra train python -m sft.train --base qwen3-8b
    uv run --extra train python -m sft.train --config sft/configs/qwen3-1.7b-smoke.yaml \
        --set max_steps=200 --set run=sft-smoke

Writes the adapter / model to ``checkpoints/<run>`` and the run record to ``results/<run>.json``
(config, data hash, git SHA, train metrics).
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path
from typing import Any

import yaml

from sft.data import load_sft_examples
from sft.masking import PadCollator, tokenize_example
from sft.results import ML_ROOT, file_hash, write_result

CONFIG_DIR = Path(__file__).parent / "configs"


def load_config(path: Path, overrides: list[str]) -> dict[str, Any]:
    cfg = yaml.safe_load(Path(path).read_text())
    for item in overrides:
        key, _, raw = item.partition("=")
        node = cfg
        *parents, leaf = key.split(".")
        for p in parents:
            node = node.setdefault(p, {})
        node[leaf] = yaml.safe_load(raw)
    return cfg


def build_model(cfg: dict[str, Any]):
    import torch
    from transformers import AutoModelForCausalLM

    model = AutoModelForCausalLM.from_pretrained(
        cfg["model"],
        dtype=torch.bfloat16,
        attn_implementation=cfg.get("attn_implementation", "sdpa"),
    )
    if cfg.get("gradient_checkpointing", True):
        model.config.use_cache = False
    return model


def peft_config(cfg: dict[str, Any]):
    lora = cfg.get("lora")
    if not lora:
        return None
    from peft import LoraConfig

    return LoraConfig(
        r=lora["r"],
        lora_alpha=lora.get("alpha", 2 * lora["r"]),
        lora_dropout=lora.get("dropout", 0.05),
        target_modules=lora.get("target_modules", "all-linear"),
        task_type="CAUSAL_LM",
    )


def time_budget_callback(minutes: float):
    """Stops training cleanly once the wall-clock budget is spent (smoke runs)."""
    from transformers import TrainerCallback

    class TimeBudget(TrainerCallback):
        def on_train_begin(self, args, state, control, **kwargs):
            self.deadline = time.time() + minutes * 60

        def on_step_end(self, args, state, control, **kwargs):
            if time.time() >= self.deadline:
                control.should_training_stop = True
            return control

    return TimeBudget()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", help="config name in sft/configs (e.g. qwen3-8b)")
    ap.add_argument("--config", type=Path)
    ap.add_argument("--set", action="append", default=[], help="override key=value (yaml value)")
    args = ap.parse_args()
    cfg_path = args.config or CONFIG_DIR / f"{args.base}.yaml"
    cfg = load_config(cfg_path, args.set)
    run = cfg.get("run") or f"sft-{cfg_path.stem}"

    from datasets import Dataset
    from transformers import AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    data_cfg = cfg["data"]
    examples, source, data_files = load_sft_examples(
        ML_ROOT / data_cfg["oracle"] if data_cfg.get("oracle") else None,
        ML_ROOT / data_cfg["personas"] if data_cfg.get("personas") else None,
        data_cfg.get("splits", ["train"]),
    )
    random.Random(cfg.get("seed", 0)).shuffle(examples)
    if data_cfg.get("max_examples"):
        examples = examples[: data_cfg["max_examples"]]

    tok = AutoTokenizer.from_pretrained(cfg["model"])
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    max_len = cfg.get("max_length", 16384)
    rows = [
        r
        for ex in examples
        if (
            r := tokenize_example(
                ex,
                tok,
                max_len,
                cfg.get("assistant_start", "<|im_start|>assistant\n"),
                cfg.get("turn_end", "<|im_end|>"),
                cfg.get("chat_template_kwargs"),
            )
        )
    ]
    n_eval = min(int(len(rows) * data_cfg.get("eval_fraction", 0.02)), 500)
    train_ds = Dataset.from_list(rows[n_eval:])
    eval_ds = Dataset.from_list(rows[:n_eval]) if n_eval else None
    trained_tokens = sum(sum(x != -100 for x in r["labels"]) for r in rows[n_eval:])

    out_dir = ML_ROOT / "checkpoints" / run
    t = cfg["train"]
    sft_args = SFTConfig(
        output_dir=str(out_dir),
        num_train_epochs=t.get("epochs", 2),
        max_steps=t.get("max_steps", -1),
        learning_rate=t["lr"],
        lr_scheduler_type=t.get("scheduler", "cosine"),
        warmup_steps=t.get("warmup_ratio", 0.03),  # a float < 1 is a ratio in transformers 5
        per_device_train_batch_size=t.get("per_device_batch", 1),
        per_device_eval_batch_size=t.get("per_device_batch", 1),
        gradient_accumulation_steps=t.get("grad_accum", 8),
        gradient_checkpointing=cfg.get("gradient_checkpointing", True),
        gradient_checkpointing_kwargs={"use_reentrant": False},
        bf16=True,
        logging_steps=t.get("logging_steps", 5),
        eval_strategy="steps" if eval_ds is not None else "no",
        eval_steps=t.get("eval_steps", 50),
        save_strategy="no",
        report_to=t.get("report_to", "none"),
        seed=cfg.get("seed", 0),
        max_length=max_len,
        remove_unused_columns=False,
        dataset_kwargs={"skip_prepare_dataset": True},
    )
    trainer = SFTTrainer(
        model=build_model(cfg),
        args=sft_args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
        data_collator=PadCollator(tok.pad_token_id),
        processing_class=tok,
        peft_config=peft_config(cfg),
        callbacks=[time_budget_callback(t["max_minutes"])] if t.get("max_minutes") else None,
    )
    t0 = time.time()
    train_out = trainer.train()
    wall = time.time() - t0
    metrics: dict[str, Any] = dict(train_out.metrics)
    if eval_ds is not None:
        metrics.update(trainer.evaluate())
    trainer.save_model(str(out_dir))
    tok.save_pretrained(str(out_dir))

    history = [h for h in trainer.state.log_history if "loss" in h]
    record = {
        "stage": "sft",
        "config": cfg,
        "config_file": str(cfg_path.relative_to(ML_ROOT))
        if cfg_path.is_absolute()
        else str(cfg_path),
        "data": {
            "source": source,
            "files": [str(p) for p in data_files],
            "hash": file_hash(*data_files),
            "examples_loaded": len(examples),
            "examples_tokenized": len(rows),
            "train_examples": len(train_ds),
            "eval_examples": n_eval,
            "trained_tokens": int(trained_tokens),
        },
        "metrics": {
            **{k: (float(v) if isinstance(v, int | float) else v) for k, v in metrics.items()},
            "first_logged_loss": history[0]["loss"] if history else None,
            "last_logged_loss": history[-1]["loss"] if history else None,
            "wall_seconds": round(wall, 1),
            "global_steps": trainer.state.global_step,
        },
        "loss_history": [{"step": h["step"], "loss": h["loss"]} for h in history],
        "checkpoint": str(out_dir),
    }
    path = write_result(run, record)
    print(json.dumps({"result": str(path), "metrics": record["metrics"]}, indent=2))


if __name__ == "__main__":
    main()
