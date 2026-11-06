"""Rows, Parquet shards and the metrics JSON of the dialogues family.

Layout: ``<out>/<split>/<tier>-<NNNNN>.parquet`` (zstd), splits aligned with the persona splits
(``heldout_family`` stays held out). ``tools`` is stored once per row as a JSON string.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

SHARD_ROWS = 2000
SPLITS = ("train", "val", "test", "heldout_family")

_CALL = pa.struct(
    [
        ("id", pa.string()),
        ("type", pa.string()),
        ("function", pa.struct([("name", pa.string()), ("arguments", pa.string())])),
    ]
)
MESSAGE = pa.struct(
    [
        ("role", pa.string()),
        ("content", pa.string()),
        ("tool_calls", pa.list_(_CALL)),
        ("tool_call_id", pa.string()),
    ]
)
JUDGE_CRITERIA = (
    "naturalness",
    "faithfulness",
    "language_correctness",
    "boundary_compliance",
    "plain_language",
)
JUDGE = pa.struct(
    [(c, pa.int8()) for c in JUDGE_CRITERIA] + [("passed", pa.bool_()), ("reason", pa.string())]
)
SCHEMA = pa.schema(
    [
        ("id", pa.string()),
        ("family", pa.string()),
        ("tier", pa.string()),
        ("persona_id", pa.string()),
        ("split", pa.string()),
        ("language", pa.string()),
        ("source_language", pa.string()),
        ("language_variant", pa.bool_()),
        ("dialect", pa.bool_()),
        ("plain_language", pa.bool_()),
        ("safety_injected", pa.bool_()),
        ("safety_turn", pa.int16()),
        ("messages", pa.list_(MESSAGE)),
        ("tools", pa.string()),
        ("plan", pa.string()),
        ("reward", pa.float32()),
        ("reward_breakdown", pa.string()),
        ("boundary_flags", pa.int8()),
        ("citations_valid", pa.bool_()),
        ("n_turns", pa.int16()),
        ("n_tool_calls", pa.int16()),
        ("language_match", pa.float32()),
        ("turn_languages", pa.list_(pa.string())),
        ("readability_wps", pa.float32()),
        ("readability_index", pa.float32()),
        ("near_duplicate_of", pa.string()),
        ("judge", JUDGE),
        ("model", pa.string()),
        ("prompt_version", pa.string()),
        ("tokens", pa.int32()),
        ("git_sha", pa.string()),
    ]
)


def norm_message(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "role": m.get("role"),
        "content": m.get("content"),
        "tool_calls": [
            {"id": c.get("id"), "type": c.get("type", "function"), "function": c["function"]}
            for c in m.get("tool_calls") or []
        ]
        or None,
        "tool_call_id": m.get("tool_call_id"),
    }


def judge_struct(verdict: Any) -> dict[str, Any] | None:
    """Core judge verdict ``{scores, passed, reason}`` as the flat Parquet struct."""
    if not isinstance(verdict, dict) or not verdict.get("scores"):
        return None
    scores = verdict["scores"]
    return {
        **{c: scores.get(c) for c in JUDGE_CRITERIA},
        "passed": bool(verdict.get("passed")),
        "reason": verdict.get("reason"),
    }


def to_row(rec: dict[str, Any]) -> dict[str, Any]:
    msgs = rec["messages"]
    judge = rec.get("judge")
    row = {name: rec.get(name) for name in SCHEMA.names}
    row.update(
        family="dialogues",
        messages=[norm_message(m) for m in msgs],
        tools=json.dumps(rec.get("tools") or [], ensure_ascii=False),
        plan=json.dumps(rec.get("plan"), ensure_ascii=False),
        reward_breakdown=json.dumps(rec.get("reward_breakdown") or {}, ensure_ascii=False),
        n_turns=sum(1 for m in msgs if m["role"] in ("user", "assistant") and m.get("content")),
        n_tool_calls=sum(len(m.get("tool_calls") or []) for m in msgs),
        judge=judge_struct(judge),
    )
    return row


def write_shards(records: list[dict[str, Any]], out_dir: Path) -> dict[str, int]:
    """Rewrite all shards from the kept records (idempotent)."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for rec in records:
        groups[(rec["split"], rec["tier"])].append(rec)
    for old in out_dir.glob("*/*.parquet"):
        old.unlink()
    counts: dict[str, int] = {}
    for (split, tier), recs in sorted(groups.items()):
        recs.sort(key=lambda r: r["id"])
        (out_dir / split).mkdir(parents=True, exist_ok=True)
        for start in range(0, len(recs), SHARD_ROWS):
            table = pa.Table.from_pylist(
                [to_row(r) for r in recs[start : start + SHARD_ROWS]], schema=SCHEMA
            )
            path = out_dir / split / f"{split}-tier{tier}-{start // SHARD_ROWS:05d}.parquet"
            tmp = path.with_suffix(".tmp")
            pq.write_table(table, tmp, compression="zstd", compression_level=9)
            tmp.replace(path)
        counts[f"{split}/{tier}"] = len(recs)
    return counts


def write_stream(rows, out_dir: Path, tier: str) -> dict[str, int]:
    """Write a large row stream (tier O) per split in shards without holding it in memory."""
    buffers: dict[str, list[dict[str, Any]]] = defaultdict(list)
    index: dict[str, int] = defaultdict(int)
    counts: dict[str, int] = defaultdict(int)

    def flush(split: str) -> None:
        recs = buffers.pop(split, [])
        if not recs:
            return
        (out_dir / split).mkdir(parents=True, exist_ok=True)
        table = pa.Table.from_pylist([to_row(r) for r in recs], schema=SCHEMA)
        path = out_dir / split / f"{split}-tier{tier}-{index[split]:05d}.parquet"
        tmp = path.with_suffix(".tmp")
        pq.write_table(table, tmp, compression="zstd", compression_level=9)
        tmp.replace(path)
        index[split] += 1

    for rec in rows:
        buffers[rec["split"]].append(rec)
        counts[f"{rec['split']}/{tier}"] += 1
        if len(buffers[rec["split"]]) >= SHARD_ROWS:
            flush(rec["split"])
    for split in list(buffers):
        flush(split)
    return dict(counts)


def metrics(
    records: list[dict[str, Any]], rejects: list[dict[str, Any]], extra: dict[str, Any]
) -> dict[str, Any]:
    def mean(values: list[float]) -> float | None:
        return round(sum(values) / len(values), 4) if values else None

    by = Counter((r["tier"], r["split"], r["language"]) for r in records)
    judged = [s for s in (judge_struct(r.get("judge")) for r in records) if s]
    return {
        "family": "dialogues",
        "kept": len(records),
        "kept_unique": sum(1 for r in records if not r.get("near_duplicate_of")),
        "near_duplicates": sum(1 for r in records if r.get("near_duplicate_of")),
        "rejected": len(rejects),
        "reject_reasons": Counter(p for r in rejects for p in r.get("problems", [])).most_common(),
        "counts": {f"{t}/{s}/{lang}": n for (t, s, lang), n in sorted(by.items())},
        "per_tier": dict(Counter(r["tier"] for r in records)),
        "per_language": dict(Counter(r["language"] for r in records)),
        "per_split": dict(Counter(r["split"] for r in records)),
        "safety_injected": sum(bool(r.get("safety_injected")) for r in records),
        "plain_language": sum(bool(r.get("plain_language")) for r in records),
        "dialect": sum(bool(r.get("dialect")) for r in records),
        "reward_mean": mean([r["reward"] for r in records]),
        "boundary_flags": sum(int(r.get("boundary_flags") or 0) for r in records),
        "language_match_mean": mean(
            [r["language_match"] for r in records if r.get("language_match") is not None]
        ),
        "judge_n": len(judged),
        "judge_pass_rate": mean([float(j["passed"]) for j in judged]),
        "judge_mean": {c: mean([float(j[c]) for j in judged if j.get(c)]) for c in JUDGE_CRITERIA},
        "tokens": sum(int(r.get("tokens") or 0) for r in records)
        + sum(int(r.get("tokens") or 0) for r in rejects),
        **extra,
    }


def card(m: dict[str, Any]) -> str:
    """Dataset-card section of the dialogues config (merged into the HF README by publish)."""
    return f"""## Config `dialogues`

Multi-turn, tool-exact pilot dialogues for Austrian social-benefits navigation. Every dialogue is
an OpenAI-style `messages` list (system, user, assistant with `tool_calls`, tool) with the real
brain tool contracts (`lotse_*`) and outputs from the research tool server, ending in a
`submit_plan` call. Labels (benefits, offices, documents, citations, reward) come from the product
engine and the gym reward, never from a language model.

- **Tier O** (oracle): the gym oracle's own trajectories (template questions and summaries in
  German, English or Turkish, exact tool calls and outputs, reward 1.0); no model text.
- **Tier A** (verbalized oracle): gym oracle trajectories; tool calls, tool outputs and the plan
  are unchanged, the bulk model wrote only the natural-language turns in the target language
  (German incl. Austrian dialect and plain language, English, Turkish, BCS, Romanian, Hungarian,
  Polish, Ukrainian, Arabic), with injected medical questions handed off to a doctor/1450 in a
  sample (`safety_injected`). In `language_variant` rows the user speaks a language other than the
  persona's; tool arguments keep the original situation text.
- **Tier B** (teacher): the strong model played the pilot in the gym against an LLM-simulated user
  with the real tools; kept only with gym reward >= 0.9, zero boundary flags and valid citations.
- **Quality:** every dialogue re-scored with the gym reward (`reward`, `reward_breakdown`); product
  boundary patterns (`boundary_flags` = 0 for all kept rows); language ID on every turn
  (`turn_languages`, `language_match`); MinHash near-duplicates marked (`near_duplicate_of`);
  readability of the pilot's turns; LLM judge rubric on every tier A dialogue (`judge`, only
  passing rows are released).
- **Splits** follow the persona splits; `heldout_family` holds the held-out benefit family.

Rows: {m.get("release_rows")} ({m.get("per_tier")}); tier A/B languages: {m.get("per_language")};
mean reward of tier A/B {m.get("reward_mean")}. Every tier A row was judged and passed the rubric
(naturalness, faithfulness to tool outputs, language correctness, boundary compliance, plain
language where requested; each >= 4 of 5); pass rate over all judged attempts
{m.get("tier_A_judge_pass_rate_all_attempts")} ({m.get("tier_A_judged")} judged).
"""
