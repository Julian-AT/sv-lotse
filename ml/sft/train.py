"""SFT with TRL SFTTrainer (+ PEFT LoRA): loss on assistant and tool-call tokens only.

    uv run --extra train python -m sft.train --base qwen3-8b
    uv run --extra train python -m sft.train --config sft/configs/qwen3-1.7b-smoke.yaml \
        --set max_steps=200 --set run=sft-smoke
    # HF data (JulianAT/at-benefits dialogues), 3×H100 DDP:
    accelerate launch --config_file sft/configs/accelerate-ddp.yaml -m sft.train \
        --config sft/configs/qwen3-8b-sft.yaml
    # config check without GPU (add --check-data to download and compact the data):
    uv run python -m sft.train --config sft/configs/qwen3-8b-sft.yaml --dry-run

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

from sft.data import (
    DEFAULT_TIERS,
    DEFAULT_TOOL_MAX_CHARS,
    HF_DATASET,
    HFSource,
    filter_by_length,
    load_hf_dialogues,
    load_hf_personas,
    load_sft_examples,
    plan_example,
)
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


def attn_implementation(cfg: dict[str, Any]) -> str:
    """The configured attention kernel; flash_attention_2 falls back to sdpa when not installed."""
    impl = cfg.get("attn_implementation", "sdpa")
    if impl == "flash_attention_2":
        import importlib.util

        if importlib.util.find_spec("flash_attn") is None:
            print("flash_attn not installed: falling back to sdpa", flush=True)
            return "sdpa"
    return impl


def build_model(cfg: dict[str, Any]):
    import torch
    from transformers import AutoModelForCausalLM

    model = AutoModelForCausalLM.from_pretrained(
        cfg["model"],
        dtype=torch.bfloat16,
        attn_implementation=attn_implementation(cfg),
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


def load_hf_data(cfg: dict[str, Any]) -> dict[str, Any]:
    """Train/eval examples from JulianAT/at-benefits (dialogues, plus optional plan examples)."""
    d = cfg["data"]
    src = HFSource(d.get("repo", HF_DATASET), d.get("revision"))
    tiers = d.get("tiers", list(DEFAULT_TIERS))
    limit = d.get("tool_max_chars", DEFAULT_TOOL_MAX_CHARS)
    train, files, _ = load_hf_dialogues(d.get("splits", ["train"]), tiers, limit, src)
    eval_split = d.get("eval_split", "val")
    evals, eval_files, _ = (
        load_hf_dialogues([eval_split], tiers, limit, src) if eval_split else ([], [], src)
    )
    plans = []
    if d.get("plan_examples"):
        personas, persona_files, _ = load_hf_personas("train", d["plan_examples"], src)
        personas.sort(key=lambda p: str(p.get("id")))
        plans = [
            {**plan_example(p), "split": "train", "tier": "plan"}
            for p in personas[: d["plan_examples"]]
        ]
        files += persona_files
    return {
        "train": train + plans,
        "eval": evals,
        "files": files + eval_files,
        "info": {
            "repo": src.repo,
            "revision": src.revision,
            "tiers": tiers,
            "tool_max_chars": limit,
            "eval_split": eval_split,
            "plan_examples": len(plans),
            "files": [str(Path(f).name) for f in files + eval_files],
        },
    }


def dry_run(cfg: dict[str, Any], cfg_path: Path, check_data: bool) -> None:
    """Validates the config without torch or a GPU; ``check_data`` also downloads and compacts."""
    t = cfg["train"]
    for key in ("model", "data", "train"):
        if key not in cfg:
            raise SystemExit(f"config {cfg_path}: missing '{key}'")
    world = int(cfg.get("num_gpus", 1))
    out: dict[str, Any] = {
        "config": str(cfg_path),
        "run": cfg.get("run") or f"sft-{cfg_path.stem}",
        "model": cfg["model"],
        "data_source": cfg["data"].get("source", "local"),
        "max_length": cfg.get("max_length"),
        "attn_implementation": cfg.get("attn_implementation", "sdpa"),
        "lora": cfg.get("lora"),
        "effective_batch": t.get("per_device_batch", 1) * t.get("grad_accum", 8) * world,
        "lr": t["lr"],
        "epochs": t.get("epochs"),
    }
    if check_data:
        if cfg["data"].get("source") == "hf":
            data = load_hf_data(cfg)
            by_tier: dict[str, int] = {}
            for ex in data["train"]:
                by_tier[ex.get("tier") or "?"] = by_tier.get(ex.get("tier") or "?", 0) + 1
            chars = sorted(len(json.dumps(ex, ensure_ascii=False)) for ex in data["train"])
            out["data"] = {
                **data["info"],
                "train_examples": len(data["train"]),
                "train_by_tier": by_tier,
                "eval_examples": len(data["eval"]),
                "chars_median": chars[len(chars) // 2] if chars else 0,
                "chars_p90": chars[int(0.9 * len(chars))] if chars else 0,
                "hash": file_hash(*data["files"]),
            }
        else:
            examples, source, files = local_examples(cfg)
            out["data"] = {"source": source, "examples": len(examples)}
        if out["data"].get("train_examples", out["data"].get("examples")):
            steps = out["data"].get("train_examples", out["data"].get("examples", 0))
            out["optimizer_steps_per_epoch"] = steps // out["effective_batch"]
    print(json.dumps(out, indent=2, ensure_ascii=False))


def local_examples(cfg: dict[str, Any]):
    data_cfg = cfg["data"]
    return load_sft_examples(
        ML_ROOT / data_cfg["oracle"] if data_cfg.get("oracle") else None,
        ML_ROOT / data_cfg["personas"] if data_cfg.get("personas") else None,
        data_cfg.get("splits", ["train"]),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", help="config name in sft/configs (e.g. qwen3-8b)")
    ap.add_argument("--config", type=Path)
    ap.add_argument("--data", choices=["local", "hf"], help="override data.source")
    ap.add_argument("--set", action="append", default=[], help="override key=value (yaml value)")
    ap.add_argument("--dry-run", action="store_true", help="check the config, no torch / GPU")
    ap.add_argument("--check-data", action="store_true", help="with --dry-run: load the data")
    args = ap.parse_args()
    cfg_path = args.config or CONFIG_DIR / f"{args.base}.yaml"
    cfg = load_config(cfg_path, args.set)
    if args.data:
        cfg["data"]["source"] = args.data
    run = cfg.get("run") or f"sft-{cfg_path.stem}"
    if args.dry_run:
        dry_run(cfg, cfg_path, args.check_data)
        return

    from datasets import Dataset
    from transformers import AutoTokenizer
    from trl import SFTConfig, SFTTrainer

    data_cfg = cfg["data"]
    rng = random.Random(cfg.get("seed", 0))
    hf_info: dict[str, Any] | None = None
    eval_examples: list[dict[str, Any]] = []
    if data_cfg.get("source") == "hf":
        hf = load_hf_data(cfg)
        examples, source, data_files = hf["train"], "hf", hf["files"]
        eval_examples, hf_info = hf["eval"], hf["info"]
    else:
        examples, source, data_files = local_examples(cfg)
    rng.shuffle(examples)
    if data_cfg.get("max_examples"):
        examples = examples[: data_cfg["max_examples"]]

    tok = AutoTokenizer.from_pretrained(cfg["model"])
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    max_len = cfg.get("max_length", 16384)
    template_kwargs = cfg.get("chat_template_kwargs")

    def count_tokens(ex: dict[str, Any]) -> int:
        kwargs = dict(template_kwargs or {})
        if ex.get("tools"):
            kwargs["tools"] = ex["tools"]
        text = tok.apply_chat_template(ex["messages"], tokenize=False, **kwargs)
        return len(tok(text, add_special_tokens=False)["input_ids"])

    examples, length_report = filter_by_length(examples, count_tokens, max_len)
    print(f"length filter (train): {json.dumps(length_report)}", flush=True)
    if eval_examples:
        rng.shuffle(eval_examples)
        eval_examples, eval_length = filter_by_length(eval_examples, count_tokens, max_len)
        eval_examples = eval_examples[: data_cfg.get("eval_max", 300)]
        length_report = {"train": length_report, "eval": eval_length}

    def tokenize_all(items: list[dict[str, Any]]) -> list[dict[str, list[int]]]:
        return [
            r
            for ex in items
            if (
                r := tokenize_example(
                    ex,
                    tok,
                    max_len,
                    cfg.get("assistant_start", "<|im_start|>assistant\n"),
                    cfg.get("turn_end", "<|im_end|>"),
                    template_kwargs,
                )
            )
        ]

    rows = tokenize_all(examples)
    if eval_examples:
        eval_rows = tokenize_all(eval_examples)
        train_rows = rows
    else:
        n_eval = min(int(len(rows) * data_cfg.get("eval_fraction", 0.02)), 500)
        eval_rows, train_rows = rows[:n_eval], rows[n_eval:]
    n_eval = len(eval_rows)
    train_ds = Dataset.from_list(train_rows)
    eval_ds = Dataset.from_list(eval_rows) if n_eval else None
    trained_tokens = sum(sum(x != -100 for x in r["labels"]) for r in train_rows)

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
        save_strategy="steps" if t.get("save_steps") else "no",
        save_steps=t.get("save_steps", 500),
        save_total_limit=2,
        ddp_find_unused_parameters=False,
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
    resume = sorted(out_dir.glob("checkpoint-*"), key=lambda p: int(p.name.split("-")[-1]))
    if resume:
        print(f"resuming from {resume[-1]}", flush=True)
    t0 = time.time()
    train_out = trainer.train(resume_from_checkpoint=str(resume[-1]) if resume else None)
    wall = time.time() - t0
    metrics: dict[str, Any] = dict(train_out.metrics)
    if eval_ds is not None:
        metrics.update(trainer.evaluate())
    trainer.save_model(str(out_dir))
    if not trainer.is_world_process_zero():
        return
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
            "hf": hf_info,
            "length_filter": length_report,
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
