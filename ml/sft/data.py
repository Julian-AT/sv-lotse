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


# --- Hugging Face source (`--data hf`): JulianAT/at-benefits ---
#
# The `dialogues` config holds tier O (tool-exact oracle trajectories), tier A (judged natural
# dialogues, 9 languages) and tier B, each row in OpenAI chat format with `tool_calls`, split
# train/val/test/heldout_family. The `situations` config holds the personas with engine gold
# (splits train/validation/test/heldout_family). Files are listed and downloaded at one resolved
# revision so the data hash and the HF commit pin the exact training data.

HF_DATASET = "JulianAT/at-benefits"
DEFAULT_TIERS = ("O", "A", "B")
DEFAULT_TOOL_MAX_CHARS = 1500

# Fields kept when a long array is summarised: the identifiers a later tool call or the plan needs.
KEY_FIELDS = ("id", "benefitId", "officeId", "type", "status", "code", "name", "title")
# (items kept in full, max string length) per compaction level, from gentle to aggressive.
_LEVELS = ((10, 600), (6, 300), (4, 160), (3, 100), (2, 60), (1, 40), (0, 24))
# Persona fields kept from a `situations` row (the same keys the local persona files carry).
SITUATION_FIELDS = (
    "id", "split", "goal", "scenario", "life_situation", "style", "noise", "situation_text",
    "text_language", "household", "gold",
)  # fmt: skip
_JSON_FIELDS = ("household", "gold", "noise")


def _plain(value: Any) -> Any:
    """numpy arrays / pandas scalars from parquet -> plain Python containers."""
    if hasattr(value, "tolist") and not isinstance(value, str | bytes):
        value = value.tolist()
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_plain(v) for v in value]
    if isinstance(value, float) and value != value:  # NaN
        return None
    return value


def _key_view(item: Any, max_str: int) -> Any:
    if isinstance(item, dict):
        view = {k: item[k] for k in KEY_FIELDS if isinstance(item.get(k), str | int | float | bool)}
        return {k: _shrink(v, 0, max(max_str, 64)) for k, v in view.items()} or None
    if isinstance(item, str):
        return _shrink(item, 0, max_str)
    if item is None or isinstance(item, int | float | bool):
        return item
    return None


def _shrink(obj: Any, max_items: int, max_str: int) -> Any:
    if isinstance(obj, str):
        return obj if len(obj) <= max_str else obj[:max_str] + "…"
    if isinstance(obj, list):
        out = [_shrink(x, max_items, max_str) for x in obj[:max_items]]
        rest = obj[max_items:]
        if rest:
            views = [_key_view(x, max_str) for x in rest]
            if all(v is not None for v in views):
                out.extend(views)  # identifiers of every item survive
            else:
                out.append(f"… {len(rest)} more items")
        return out
    if isinstance(obj, dict):
        return {k: _shrink(v, max_items, max_str) for k, v in obj.items()}
    return obj


def compact_json_text(text: str, limit: int) -> str:
    """Shorten a tool output to at most ``limit`` characters.

    JSON stays valid JSON: long strings are cut and long arrays keep their first items in full and
    only the identifier fields (``KEY_FIELDS``) of the rest. Non-JSON text is cut with a marker.
    """
    if len(text) <= limit:
        return text
    try:
        obj = json.loads(text)
    except (TypeError, ValueError):
        marker = f" … [{len(text) - limit} chars cut]"
        return text[: max(0, limit - len(marker))] + marker
    for max_items, max_str in _LEVELS:
        out = json.dumps(_shrink(obj, max_items, max_str), ensure_ascii=False)
        if len(out) <= limit:
            return out
    # Still too long (e.g. hundreds of ids): keep a valid JSON preview.
    preview = json.dumps(_shrink(obj, 0, 24), ensure_ascii=False)
    keep = max(0, limit - 64)
    while True:
        out = json.dumps({"truncated": True, "chars": len(text), "preview": preview[:keep]})
        if len(out) <= limit or keep == 0:
            return out
        keep = max(0, keep - max(16, len(out) - limit))


def compact_messages(messages: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Copy of ``messages`` with each tool output compacted to ``limit`` characters.

    Only ``tool`` messages before the last assistant turn are touched: assistant turns (and with
    them the final plan / ``submit_plan`` call) are never cut.
    """
    last_assistant = max(
        (i for i, m in enumerate(messages) if m.get("role") == "assistant"), default=-1
    )
    out = []
    for i, msg in enumerate(messages):
        msg = dict(msg)
        if msg.get("role") == "tool" and i < last_assistant and isinstance(msg.get("content"), str):
            msg["content"] = compact_json_text(msg["content"], limit)
        out.append(msg)
    return out


def normalize_messages(raw: Any) -> list[dict[str, Any]]:
    """Parquet chat rows -> template-ready messages (None fields dropped, tool_calls as dicts)."""
    msgs = []
    for m in _plain(raw) or []:
        msg = {k: v for k, v in m.items() if v is not None}
        if not msg.get("tool_calls"):
            msg.pop("tool_calls", None)
        if msg.get("role") == "assistant" and "content" not in msg:
            msg["content"] = ""
        msgs.append(msg)
    return msgs


def dialogue_example(row: dict[str, Any], tool_max_chars: int) -> dict[str, Any] | None:
    messages = normalize_messages(row.get("messages"))
    if not any(m.get("role") == "assistant" for m in messages):
        return None
    tools = row.get("tools")
    if isinstance(tools, str):
        tools = json.loads(tools) if tools.strip() else None
    return {
        "id": row.get("id"),
        "split": row.get("split"),
        "tier": row.get("tier"),
        "messages": compact_messages(messages, tool_max_chars) if tool_max_chars else messages,
        "tools": _plain(tools) or None,
    }


def examples_from_rows(
    rows: Iterable[dict[str, Any]],
    tiers: Iterable[str] = DEFAULT_TIERS,
    splits: Iterable[str] | None = None,
    tool_max_chars: int = DEFAULT_TOOL_MAX_CHARS,
) -> list[dict[str, Any]]:
    """Dialogue rows -> SFT examples, keeping the dataset's split assignment."""
    tiers, wanted = set(tiers), set(splits) if splits else None
    out = []
    for row in rows:
        if row.get("tier") not in tiers or (wanted and row.get("split") not in wanted):
            continue
        if (ex := dialogue_example(row, tool_max_chars)) is not None:
            out.append(ex)
    return out


def persona_from_situation(row: dict[str, Any]) -> dict[str, Any]:
    """A `situations` row -> the persona dict sft/eval code expects (JSON fields parsed)."""
    out = {k: _plain(row.get(k)) for k in SITUATION_FIELDS if k in row}
    for key in _JSON_FIELDS:
        if isinstance(out.get(key), str):
            out[key] = json.loads(out[key])
    return out


def filter_by_length(
    examples: list[dict[str, Any]],
    count_tokens: Any,
    max_length: int,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Drop examples longer than ``max_length`` tokens (``count_tokens(example) -> int``)."""
    kept, dropped, longest = [], [], 0
    for ex in examples:
        n = count_tokens(ex)
        if n > max_length:
            dropped.append(ex.get("id"))
        else:
            kept.append(ex)
            longest = max(longest, n)
    report = {
        "max_length": max_length,
        "kept": len(kept),
        "dropped": len(dropped),
        "dropped_share": round(len(dropped) / len(examples), 4) if examples else 0.0,
        "dropped_ids_sample": dropped[:20],
        "longest_kept_tokens": longest,
    }
    return kept, report


class HFSource:
    """Lists and downloads `JulianAT/at-benefits` parquet files at one pinned revision."""

    def __init__(self, repo: str = HF_DATASET, revision: str | None = None):
        from huggingface_hub import HfApi

        self.repo = repo
        self.api = HfApi()
        self.revision = revision or self.api.dataset_info(repo).sha
        self._files = sorted(
            self.api.list_repo_files(repo, repo_type="dataset", revision=self.revision)
        )

    def files(self, prefix: str) -> list[str]:
        return [f for f in self._files if f.startswith(prefix) and f.endswith(".parquet")]

    def download(self, name: str) -> Path:
        from huggingface_hub import hf_hub_download

        return Path(hf_hub_download(self.repo, name, repo_type="dataset", revision=self.revision))

    def read(self, names: Iterable[str]) -> tuple[list[dict[str, Any]], list[Path]]:
        import pandas as pd

        rows, paths = [], []
        for name in names:
            path = self.download(name)
            paths.append(path)
            rows.extend(pd.read_parquet(path).to_dict(orient="records"))
        return rows, paths


def load_hf_dialogues(
    splits: Iterable[str],
    tiers: Iterable[str] = DEFAULT_TIERS,
    tool_max_chars: int = DEFAULT_TOOL_MAX_CHARS,
    source: HFSource | None = None,
) -> tuple[list[dict[str, Any]], list[Path], HFSource]:
    src = source or HFSource()
    tiers = list(tiers)
    names = [
        f
        for split in splits
        for f in src.files(f"dialogues/{split}/")
        if any(f"-tier{t}-" in f.rsplit("/", 1)[-1] for t in tiers)
    ]
    if not names:
        raise FileNotFoundError(f"no dialogues files for splits={list(splits)} tiers={tiers}")
    rows, paths = src.read(names)
    return examples_from_rows(rows, tiers, splits, tool_max_chars), paths, src


def load_hf_personas(
    split: str, n: int, source: HFSource | None = None
) -> tuple[list[dict[str, Any]], list[Path], HFSource]:
    """At least ``n`` personas of a `situations` split: whole shards in file order (deterministic
    at the pinned revision). ``val`` maps to the config's ``validation`` split."""
    src = source or HFSource()
    split = {"val": "validation"}.get(split, split)
    rows: list[dict[str, Any]] = []
    paths: list[Path] = []
    for name in src.files(f"situations/{split}/"):
        more, used = src.read([name])
        rows.extend(more)
        paths.extend(used)
        if len(rows) >= n:
            break
    if not rows:
        raise FileNotFoundError(f"no situations files for split={split}")
    return [persona_from_situation(r) for r in rows if r.get("gold")], paths, src
