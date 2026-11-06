"""Offline single-turn PROXY eval: persona card + situation text -> final-plan JSON.

This is NOT the multi-turn AT-Benefits gym. The model gets no tools, no simulated user and no
chance to ask questions; it sees the persona card (gold, noise and split removed) and the
situation text once and must answer with the final plan. The plan is scored with the gym reward
(ml/gym/reward.py) against the persona's gold. Question-count terms are therefore not exercised,
and citation validity can only be as good as what the model memorised. Use it to compare a base
model and its fine-tune on the same personas on a GPU box without the tool server; report gym
numbers (T1) only from the multi-turn gym.

    uv run --extra train python -m eval.plan_eval --model Qwen/Qwen3-8B \
        [--adapter checkpoints/sft-qwen3-8b] --personas data/personas --split test --n 200
    # personas from the published dataset (JulianAT/at-benefits, config `situations`):
    uv run --extra train python -m eval.plan_eval --model Qwen/Qwen3-8B --personas hf --n 200
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
import time
from pathlib import Path
from typing import Any

from eval.scoring import parse_plan, score_plan
from sft.data import load_hf_personas, load_personas, plan_prompt
from sft.results import ML_ROOT, file_hash, write_result


def generate_transformers(
    model_id: str,
    adapter: str | None,
    prompts: list[list[dict[str, str]]],
    max_new_tokens: int,
    batch_size: int,
    template_kwargs: dict[str, Any],
) -> list[str]:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(adapter or model_id)
    tok.padding_side = "left"
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(model_id, dtype=torch.bfloat16, device_map="auto")
    if adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter).merge_and_unload()
    model.eval()
    texts = [
        tok.apply_chat_template(p, tokenize=False, add_generation_prompt=True, **template_kwargs)
        for p in prompts
    ]
    outs: list[str] = []
    for i in range(0, len(texts), batch_size):
        enc = tok(texts[i : i + batch_size], return_tensors="pt", padding=True).to(model.device)
        with torch.no_grad():
            gen = model.generate(
                **enc, max_new_tokens=max_new_tokens, do_sample=False, pad_token_id=tok.pad_token_id
            )
        outs.extend(tok.batch_decode(gen[:, enc["input_ids"].shape[1] :], skip_special_tokens=True))
    return outs


def generate_vllm(
    model_id: str,
    adapter: str | None,
    prompts: list[list[dict[str, str]]],
    max_new_tokens: int,
    template_kwargs: dict[str, Any],
) -> list[str]:
    from vllm import LLM, SamplingParams
    from vllm.lora.request import LoRARequest

    llm = LLM(model=model_id, enable_lora=bool(adapter), max_lora_rank=64, max_model_len=8192)
    params = SamplingParams(temperature=0.0, max_tokens=max_new_tokens)
    lora = LoRARequest("sft", 1, adapter) if adapter else None
    res = llm.chat(prompts, params, lora_request=lora, chat_template_kwargs=template_kwargs)
    return [r.outputs[0].text for r in res]


def summarise(scores: list[dict[str, Any]]) -> dict[str, Any]:
    keys = sorted({k for s in scores for k, v in s.items() if isinstance(v, int | float | bool)})
    out: dict[str, Any] = {"n": len(scores)}
    for k in keys:
        vals = [float(s[k]) for s in scores if isinstance(s.get(k), int | float | bool)]
        out[f"mean_{k}"] = round(statistics.fmean(vals), 4) if vals else None
    rewards = [s["reward"] for s in scores]
    rng = random.Random(0)
    boots = sorted(statistics.fmean(rng.choices(rewards, k=len(rewards))) for _ in range(1000))
    out["reward_ci95"] = [round(boots[25], 4), round(boots[974], 4)]
    return out


def evaluate(
    model: str,
    adapter: str | None,
    personas: list[dict[str, Any]],
    backend: str,
    max_new_tokens: int,
    batch_size: int,
    template_kwargs: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    prompts = [plan_prompt(p) for p in personas]
    t0 = time.time()
    if backend == "vllm":
        texts = generate_vllm(model, adapter, prompts, max_new_tokens, template_kwargs)
    else:
        texts = generate_transformers(
            model, adapter, prompts, max_new_tokens, batch_size, template_kwargs
        )
    gen_s = time.time() - t0
    rows = []
    for persona, text in zip(personas, texts, strict=True):
        plan = parse_plan(text)
        rows.append(
            {
                "id": persona.get("id"),
                **score_plan(plan, persona, agent_messages=[text]),
                "output": text[:2000],
            }
        )
    summary = summarise([{k: v for k, v in r.items() if k not in {"id", "output"}} for r in rows])
    summary["generation_seconds"] = round(gen_s, 1)
    return summary, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--adapter", help="LoRA adapter dir from sft.train (fine-tuned model)")
    ap.add_argument(
        "--personas",
        type=Path,
        default=ML_ROOT / "data/personas",
        help="persona dir/file, or 'hf' for JulianAT/at-benefits situations",
    )
    ap.add_argument("--split", default="test")
    ap.add_argument("--n", type=int, default=200)
    ap.add_argument("--backend", choices=["transformers", "vllm"], default="transformers")
    ap.add_argument("--max-new-tokens", type=int, default=768)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--no-thinking", action="store_true", default=True)
    ap.add_argument("--run", help="results/<run>.json name")
    ap.add_argument("--samples-out", type=Path, help="write per-persona rows as jsonl")
    args = ap.parse_args()

    hf_revision = None
    if str(args.personas) == "hf":
        personas, files, src = load_hf_personas(args.split, args.n)
        data_hash, hf_revision = file_hash(*files), src.revision
    else:
        personas = load_personas(args.personas, [args.split])
        data_hash = file_hash(args.personas)
    personas.sort(key=lambda p: str(p.get("id")))
    personas = personas[: args.n]
    kwargs = {"enable_thinking": False} if args.no_thinking else {}
    summary, rows = evaluate(
        args.model,
        args.adapter,
        personas,
        args.backend,
        args.max_new_tokens,
        args.batch_size,
        kwargs,
    )
    if args.samples_out:
        args.samples_out.parent.mkdir(parents=True, exist_ok=True)
        args.samples_out.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows))
    record = {
        "stage": "eval",
        "eval": "plan_eval (single-turn proxy, not the multi-turn gym)",
        "model": args.model,
        "adapter": args.adapter,
        "split": args.split,
        "data_hash": data_hash,
        "personas_source": str(args.personas),
        "hf_revision": hf_revision,
        "persona_ids": [p.get("id") for p in personas],
        "metrics": summary,
    }
    run = args.run or f"plan-eval-{Path(args.adapter or args.model).name}"
    print(json.dumps({"result": str(write_result(run, record)), "metrics": summary}, indent=2))


if __name__ == "__main__":
    main()
