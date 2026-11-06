"""Training data for SFT and the plan proxy eval.

Two sources:
- oracle trajectories (``data/sft/oracle.jsonl``, written by the gym): one JSON object per line
  with ``messages`` (OpenAI chat format, assistant turns may carry ``tool_calls``) and optional
  ``tools``.
- single-turn plan examples derived from personas with gold (``data/personas``): the user turn is
  the persona card plus situation text, the assistant turn is the gold final plan as JSON.

Gold is never shown in a prompt; it only becomes the assistant target or the scoring reference.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

PLAN_SYSTEM_PROMPT = (
    "Du bist SV-Lotse, ein Wegweiser für österreichische Sozialversicherungsleistungen. "
    "Du gibst keine medizinischen Diagnosen oder Therapieempfehlungen. "
    "Lies die Personenkarte und die Situation und antworte ausschließlich mit einem JSON-Objekt "
    'im Schema {"benefits": [benefit_id], "office_per_benefit": {benefit_id: office_id}, '
    '"documents_per_benefit": {benefit_id: [document_id]}, "next_step": string, '
    '"citations": [string]}. Verwende die IDs aus dem Katalog.'
)

# Fields of a persona that the agent must never see.
HIDDEN_PERSONA_FIELDS = {"gold", "noise", "split"}


def read_records(path: Path) -> Iterator[dict[str, Any]]:
    """Yield records from a .jsonl/.json/.parquet file or every such file below a directory."""
    path = Path(path)
    if path.is_dir():
        files = sorted(c for c in path.rglob("*") if c.suffix in {".jsonl", ".json", ".parquet"})
        stems = {c.with_suffix("") for c in files if c.suffix == ".jsonl"}
        for child in files:
            if child.suffix == ".parquet" and child.with_suffix("") in stems:
                continue  # same split written twice; read the jsonl copy only
            yield from read_records(child)
        return
    if path.suffix == ".parquet":
        import pandas as pd

        yield from pd.read_parquet(path).to_dict(orient="records")
    elif path.suffix == ".json":
        data = json.loads(path.read_text())
        yield from (data if isinstance(data, list) else data.get("personas", [data]))
    else:
        with path.open() as fh:
            for line in fh:
                if line.strip():
                    yield json.loads(line)


def load_personas(path: Path, splits: Iterable[str] | None = None) -> list[dict[str, Any]]:
    wanted = set(splits) if splits else None
    out = []
    for rec in read_records(path):
        if "gold" not in rec:
            continue
        split = rec.get("split") or _split_from_name(rec)
        if wanted is None or split in wanted:
            out.append(rec)
    return out


def _split_from_name(rec: dict[str, Any]) -> str | None:
    return rec.get("_split")


def persona_card(persona: dict[str, Any]) -> dict[str, Any]:
    """The persona without gold, noise parameters and split: what an agent may see."""
    return {k: v for k, v in persona.items() if k not in HIDDEN_PERSONA_FIELDS | {"situation_text"}}


def plan_prompt(persona: dict[str, Any]) -> list[dict[str, str]]:
    card = json.dumps(persona_card(persona), ensure_ascii=False, sort_keys=True)
    user = f"Personenkarte:\n{card}\n\nSituation:\n{persona.get('situation_text', '')}"
    return [
        {"role": "system", "content": PLAN_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def _primary_benefit(gold: dict[str, Any]) -> str | None:
    """The goal benefit the gym's next-step term expects when gold has no explicit next step."""
    from gym.reward import normalize_gold, primary_benefit

    return primary_benefit(normalize_gold(gold))


def gold_plan(gold: dict[str, Any]) -> dict[str, Any]:
    """Final-plan JSON from a persona's gold block (fields the gold lacks stay empty)."""
    benefits = list(gold.get("benefits", []))
    return {
        "benefits": benefits,
        "office_per_benefit": dict(gold.get("office_per_benefit") or gold.get("offices") or {}),
        "documents_per_benefit": dict(
            gold.get("documents_per_benefit") or gold.get("documents") or {}
        ),
        "next_step": gold.get("next_step") or _primary_benefit(gold),
        "citations": list(gold.get("citations", [])),
    }


def plan_example(persona: dict[str, Any]) -> dict[str, Any]:
    target = json.dumps(gold_plan(persona["gold"]), ensure_ascii=False)
    return {
        "id": persona.get("id"),
        "messages": [*plan_prompt(persona), {"role": "assistant", "content": target}],
    }


def load_sft_examples(
    oracle: Path | None, personas: Path | None, splits: Iterable[str] = ("train",)
) -> tuple[list[dict[str, Any]], str, list[Path]]:
    """Oracle trajectories if present, else plan examples from personas.

    Returns (examples, source name, files used for the data hash).
    """
    if oracle and Path(oracle).exists() and Path(oracle).stat().st_size > 0:
        examples = []
        wanted = set(splits)
        for rec in read_records(Path(oracle)):
            if rec.get("split") and rec["split"] not in wanted:
                continue
            msgs = rec.get("messages") or rec.get("trajectory")
            if msgs:
                examples.append({"id": rec.get("id"), "messages": msgs, "tools": rec.get("tools")})
        if examples:
            return examples, "oracle", [Path(oracle)]
    if personas and Path(personas).exists():
        examples = [plan_example(p) for p in load_personas(Path(personas), splits)]
        return examples, "persona_plans", [Path(personas)]
    raise FileNotFoundError(f"no training data at {oracle} or {personas}")
