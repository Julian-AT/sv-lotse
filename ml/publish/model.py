"""Publish a trained SFT run to Hugging Face (`python -m publish.model`).

    uv run python -m publish.model --config sft/configs/qwen3-8b-sft.yaml            # adapter
    uv run --extra train python -m publish.model --config ... --merged               # + merged bf16
    uv run python -m publish.model --config ... --dry-run                            # card only

Reads ``results/<run>.json`` (train record) and, when present, ``results/<run>-eval-base.json`` /
``results/<run>-eval-sft.json`` (plan proxy eval) and uploads to ``<user>/<hub_repo>``:

- without ``--merged``: the LoRA adapter at the repo root;
- with ``--merged``: the merged bf16 weights at the root and the adapter under ``adapter/``
  (merging needs torch, peft and the base weights: run it on the GPU box).

Plus ``README.md`` (model card) and ``results.json``. HF_TOKEN comes from the environment or the
repository's ``.env.local`` (loaded in-process, never printed). ``--dry-run`` writes the card to
``results/model-card-<run>.md`` and uploads nothing.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path
from typing import Any

import yaml

ML = Path(__file__).resolve().parents[1]
RESULTS = ML / "results"
DATASETS = ("JulianAT/at-benefits", "JulianAT/at-sv-law")
LICENCES = {"Qwen/": "apache-2.0", "utter-project/EuroLLM": "apache-2.0"}
EVAL_KEYS = (
    ("mean_reward", "Reward (gym §5.5, plan terms)"),
    ("mean_f1_benefits", "F1 benefits"),
    ("mean_acc_office", "Office accuracy"),
    ("mean_f1_documents", "F1 documents"),
    ("mean_cite_valid", "Citation validity"),
    ("mean_next_step_correct", "Next step correct"),
    ("mean_no_plan", "No parseable plan (lower is better)"),
    ("mean_boundary", "Boundary flags (lower is better)"),
)
ADAPTER_FILES = (
    "adapter_config.json",
    "adapter_model.safetensors",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "chat_template.jinja",
    "added_tokens.json",
    "vocab.json",
    "merges.txt",
)


def token_from_env(env_file: Path | None) -> str:
    if not os.environ.get("HF_TOKEN"):
        from dotenv import load_dotenv

        path = env_file or ML.parent / ".env.local"
        if path.exists():
            load_dotenv(path, override=False)
    token = os.environ.get("HF_TOKEN")
    if not token:
        sys.exit("HF_TOKEN missing: export it or add it to .env.local (it is never printed)")
    return token


def read_json(path: Path) -> dict[str, Any] | None:
    return json.loads(path.read_text()) if path.exists() else None


def licence_for(model: str, cfg: dict[str, Any]) -> str:
    if cfg.get("licence"):
        return cfg["licence"]
    return next((v for k, v in LICENCES.items() if model.startswith(k)), "other")


def _fmt(v: Any) -> str:
    return f"{v:.3f}" if isinstance(v, int | float) else "–"


def eval_table(base: dict[str, Any] | None, sft: dict[str, Any] | None) -> str:
    if not base and not sft:
        return "_No evaluation results were found for this run._\n"
    b, s = (base or {}).get("metrics", {}), (sft or {}).get("metrics", {})
    lines = ["| Metric | Base | Fine-tuned | Δ |", "| --- | ---: | ---: | ---: |"]
    for key, label in EVAL_KEYS:
        if key not in b and key not in s:
            continue
        bv, sv = b.get(key), s.get(key)
        delta = sv - bv if isinstance(bv, int | float) and isinstance(sv, int | float) else None
        lines.append(f"| {label} | {_fmt(bv)} | {_fmt(sv)} | {_fmt(delta)} |")
    ci = [f"base {b['reward_ci95']}" if b.get("reward_ci95") else "",
          f"fine-tuned {s['reward_ci95']}" if s.get("reward_ci95") else ""]  # fmt: skip
    ci_text = ", ".join(x for x in ci if x)
    n = s.get("n") or b.get("n")
    split = (sft or base or {}).get("split", "test")
    lines.append("")
    lines.append(
        f"n = {n} personas from the `{split}` split of `JulianAT/at-benefits` (config "
        f"`situations`), greedy decoding, thinking disabled. Reward 95% bootstrap CI: {ci_text}."
    )
    return "\n".join(lines) + "\n"


def model_card(
    repo_id: str,
    cfg: dict[str, Any],
    train: dict[str, Any],
    base: dict[str, Any] | None,
    sft: dict[str, Any] | None,
    merged: bool,
) -> str:
    model = cfg["model"]
    licence = licence_for(model, cfg)
    data = train.get("data", {})
    hf = data.get("hf") or {}
    metrics = train.get("metrics", {})
    lora = cfg.get("lora") or {}
    langs = ["de", "en", "tr", "bs", "hr", "sr", "ro", "hu", "pl", "uk", "ar"]
    front = {
        "license": licence,
        "base_model": model,
        "library_name": "transformers" if merged else "peft",
        "pipeline_tag": "text-generation",
        "language": langs,
        "datasets": list(DATASETS),
        "tags": ["sv-lotse", "social-insurance", "austria", "tool-use", "lora", "sft"],
    }
    usage_adapter = (
        "from peft import PeftModel\n"
        "from transformers import AutoModelForCausalLM, AutoTokenizer\n\n"
        f'base = AutoModelForCausalLM.from_pretrained("{model}", dtype="bfloat16")\n'
        f'model = PeftModel.from_pretrained(base, "{repo_id}"'
        + (', subfolder="adapter"' if merged else "")
        + ")\n"
        f'tok = AutoTokenizer.from_pretrained("{repo_id}")\n'
    )
    usage_merged = (
        "from transformers import AutoModelForCausalLM, AutoTokenizer\n\n"
        f'model = AutoModelForCausalLM.from_pretrained("{repo_id}", dtype="bfloat16")\n'
        f'tok = AutoTokenizer.from_pretrained("{repo_id}")\n'
    )
    train_cfg = {k: cfg.get(k) for k in ("model", "max_length", "lora", "train", "data", "seed")}
    eval_note = (
        "The evaluation is the **single-turn plan proxy** (`ml/eval/plan_eval.py`): the model "
        "sees a persona card and situation text once, without tools or a simulated user, and "
        "must answer with the final plan JSON, which is scored with the AT-Benefits gym reward "
        "against engine gold. It is not the multi-turn gym benchmark."
    )
    return f"""---
{yaml.safe_dump(front, sort_keys=False, allow_unicode=True).strip()}
---

# {repo_id.split("/")[-1]}

LoRA fine-tune of [`{model}`](https://huggingface.co/{model}) for **SV KI-Lotse**, a research
assistant that helps people in Austria find social-insurance benefits, the responsible office and
the documents they need. It is trained to clarify a situation with few questions, call the Lotse
tools (catalog search, office resolution, document checklist) and submit a cited plan.

{
        "Merged bf16 weights at the repository root; the LoRA adapter is in `adapter/`."
        if merged
        else "This repository holds the LoRA adapter (load it on top of the base model)."
    }

## Usage

```python
{usage_merged if merged else usage_adapter}```

Use the tool schemas and system prompt from the `dialogues` config of
[JulianAT/at-benefits](https://huggingface.co/datasets/JulianAT/at-benefits) and disable thinking
(`enable_thinking=False` in the chat template).

## Training data

- [JulianAT/at-benefits](https://huggingface.co/datasets/JulianAT/at-benefits), config
  `dialogues`, split `train`, tiers {", ".join(hf.get("tiers", []) or ["–"])} (O: tool-exact
  oracle trajectories, A: judged natural dialogues in 9 languages, B), revision
  `{hf.get("revision", "–")}`; tool outputs compacted to {hf.get("tool_max_chars", "–")}
  characters (valid JSON, every identifier kept); {hf.get("plan_examples", 0)} single-turn plan
  examples from config `situations` (split `train`).
- [JulianAT/at-sv-law](https://huggingface.co/datasets/JulianAT/at-sv-law): the RIS law corpus the
  catalog citations and the dataset's legal grounding come from (not trained on directly).
- Examples longer than {cfg.get("max_length")} tokens after the chat template were dropped:
  `{json.dumps(data.get("length_filter"), ensure_ascii=False)}`.
- Train examples: {data.get("train_examples")}, eval examples: {data.get("eval_examples")},
  trained (assistant and tool-call) tokens: {data.get("trained_tokens")}.
- Data hash: `{data.get("hash")}`.

Loss is on assistant and tool-call tokens only; system, user and tool-response tokens are masked.

## Training procedure

LoRA r = {lora.get("r")}, alpha = {lora.get("alpha")}, dropout = {lora.get("dropout")}, target
`{lora.get("target_modules")}`; bf16, gradient checkpointing, sequence length
{cfg.get("max_length")}, data-parallel on 3×H100. Final train loss
{_fmt(metrics.get("train_loss"))}, eval loss {_fmt(metrics.get("eval_loss"))},
{metrics.get("global_steps")} optimizer steps, {metrics.get("wall_seconds")} s wall clock.
Code: `ml/sft/train.py` at git `{train.get("git_sha")}`.

<details><summary>Full training config</summary>

```yaml
{yaml.safe_dump(train_cfg, sort_keys=False, allow_unicode=True).strip()}
```

</details>

## Evaluation

{eval_table(base, sft)}
{eval_note}

## Intended use and limitations

- Research on tool-using assistants for benefits navigation in Austrian social insurance, and as
  a candidate model behind the SV KI-Lotse model gateway in supervised demos.
- **Not for production medical or legal advice.** The model is not a substitute for the social
  insurance carriers, a doctor or a lawyer; eligibility decisions are made by the responsible
  office.
- **Medical boundary:** the model must not give diagnoses, therapy or medication
  recommendations. In the product a separate guard layer enforces this boundary; the model alone
  does not guarantee it.
- Benefit, office and document identifiers come from the SV KI-Lotse catalog at training time;
  outputs can be outdated or wrong, and citations must be checked against the catalog sources.
- Training data is synthetic (personas, oracle and model-generated dialogues); real users phrase
  things differently.

## Licence

The adapter / weights are released under the base model's licence ({licence}). The training data
is CC BY 4.0 (see the dataset cards).
"""


def merge_adapter(base_model: str, adapter: Path, out: Path) -> Path:
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if (out / "config.json").exists():
        return out
    model = AutoModelForCausalLM.from_pretrained(base_model, dtype=torch.bfloat16)
    model = PeftModel.from_pretrained(model, str(adapter)).merge_and_unload()
    model.save_pretrained(str(out), safe_serialization=True, max_shard_size="5GB")
    AutoTokenizer.from_pretrained(str(adapter)).save_pretrained(str(out))
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--config", type=Path, default=Path("sft/configs/qwen3-8b-sft.yaml"))
    ap.add_argument("--run", help="run name (default: config `run`)")
    ap.add_argument("--repo", help="HF repo name (default: config `hub_repo`)")
    ap.add_argument("--user", help="HF user/org (default: HF_USERNAME or the token owner)")
    ap.add_argument("--checkpoint", type=Path, help="adapter dir (default: checkpoints/<run>)")
    ap.add_argument("--merged", action="store_true", help="also upload merged bf16 weights")
    ap.add_argument("--merge-only", action="store_true", help="merge locally, upload nothing")
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="write the card locally only")
    ap.add_argument("--env-file", type=Path)
    args = ap.parse_args(argv)

    cfg_path = args.config if args.config.is_absolute() else ML / args.config
    cfg = yaml.safe_load(cfg_path.read_text())
    run = args.run or cfg.get("run") or f"sft-{cfg_path.stem}"
    repo_name = args.repo or cfg.get("hub_repo") or run
    adapter = args.checkpoint or ML / "checkpoints" / run
    merged_dir = ML / "checkpoints" / f"{run}-merged"

    if args.merge_only:
        print(merge_adapter(cfg["model"], adapter, merged_dir))
        return

    train = read_json(RESULTS / f"{run}.json")
    if train is None:
        sys.exit(f"missing results/{run}.json (train record)")
    base = read_json(RESULTS / f"{run}-eval-base.json")
    sft = read_json(RESULTS / f"{run}-eval-sft.json")
    user = args.user or os.environ.get("HF_USERNAME") or "JulianAT"
    if args.dry_run:
        repo_id = f"{user}/{repo_name}"
        out = RESULTS / f"model-card-{run}.md"
        out.write_text(model_card(repo_id, cfg, train, base, sft, args.merged))
        print(f"dry run: card for {repo_id} written to {out}")
        return

    from huggingface_hub import HfApi

    token = token_from_env(args.env_file)
    api = HfApi(token=token)
    user = args.user or os.environ.get("HF_USERNAME") or api.whoami()["name"]
    repo_id = f"{user}/{repo_name}"
    missing = [f for f in ("adapter_config.json", "adapter_model.safetensors")
               if not (adapter / f).exists()]  # fmt: skip
    if missing:
        sys.exit(f"adapter incomplete in {adapter}: missing {missing}")

    api.create_repo(repo_id, repo_type="model", private=args.private, exist_ok=True)
    adapter_prefix = "adapter/" if args.merged else ""
    allow = [f for f in ADAPTER_FILES if (adapter / f).exists()]
    api.upload_folder(
        folder_path=str(adapter),
        repo_id=repo_id,
        path_in_repo=adapter_prefix or None,
        allow_patterns=allow,
        commit_message=f"Add LoRA adapter ({run})",
    )
    if args.merged:
        merged = merge_adapter(cfg["model"], adapter, merged_dir)
        api.upload_folder(
            folder_path=str(merged),
            repo_id=repo_id,
            commit_message=f"Add merged bf16 weights ({run})",
        )
    combined = {"train": train, "eval_base": base, "eval_sft": sft}
    api.upload_file(
        path_or_fileobj=json.dumps(combined, indent=2, ensure_ascii=False).encode(),
        path_in_repo="results.json",
        repo_id=repo_id,
        commit_message="Add run record",
    )
    info = api.upload_file(
        path_or_fileobj=model_card(repo_id, cfg, train, base, sft, args.merged).encode(),
        path_in_repo="README.md",
        repo_id=repo_id,
        commit_message="Add model card",
    )
    url = f"https://huggingface.co/{repo_id}"
    record = {
        "model": repo_id,
        "url": url,
        "run": run,
        "merged": args.merged,
        "published_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "hf_commit": getattr(info, "oid", None),
        "git_sha": train.get("git_sha"),
        "data_hash": train.get("data", {}).get("hash"),
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / f"publish-model-{run}.json").write_text(json.dumps(record, indent=2))
    print(url)


if __name__ == "__main__":
    main()
