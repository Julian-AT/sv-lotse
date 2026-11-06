"""Metrics of §5.6: benefit F1, office accuracy, document F1, excess questions (median, p90),
pass^k for k = 1…8 (τ-bench), boundary violations, citation validity, tokens and latency per case;
aggregated overall and per split, language and area, with 95 % bootstrap intervals.

An episode record is a dict with at least ``persona_id`` and the reward breakdown fields
(``f1_benefits``, ``acc_office``, ``f1_documents``, ``cite_valid``, ``next_step_correct``,
``excess_questions``, ``boundary``, ``uncited``, ``malformed``, ``reward``); optional ``split``,
``language``, ``area``, ``tokens``, ``latency_s``.
"""

from __future__ import annotations

from collections import defaultdict
from math import comb
from typing import Any

import numpy as np

MEAN_FIELDS = (
    "reward",
    "f1_benefits",
    "acc_office",
    "f1_documents",
    "cite_valid",
    "next_step_correct",
    "boundary",
    "uncited",
    "malformed",
)
SUCCESS_THRESHOLD = 0.9


def is_success(record: dict[str, Any], threshold: float = SUCCESS_THRESHOLD) -> bool:
    return float(record["reward"]) >= threshold and not record.get("boundary")


def pass_hat_k(
    records: list[dict[str, Any]], k_max: int = 8, threshold: float = SUCCESS_THRESHOLD
) -> dict[str, float | None]:
    """τ-bench pass^k: mean over personas of C(c, k) / C(n, k), n trials and c successes."""
    trials: dict[str, list[bool]] = defaultdict(list)
    for record in records:
        trials[str(record["persona_id"])].append(is_success(record, threshold))
    out: dict[str, float | None] = {}
    for k in range(1, k_max + 1):
        values = [comb(sum(t), k) / comb(len(t), k) for t in trials.values() if len(t) >= k]
        out[f"pass^{k}"] = float(np.mean(values)) if values else None
    return out


def bootstrap_ci(
    values: list[float], *, n_boot: int = 1000, seed: int = 0
) -> tuple[float, float] | None:
    if len(values) < 2:
        return None
    rng = np.random.default_rng(seed)
    arr = np.asarray(values, dtype=float)
    means = arr[rng.integers(0, len(arr), size=(n_boot, len(arr)))].mean(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    return float(lo), float(hi)


def summarize(
    records: list[dict[str, Any]], *, k_max: int = 8, n_boot: int = 1000
) -> dict[str, Any]:
    if not records:
        return {"n": 0}
    out: dict[str, Any] = {
        "n": len(records),
        "personas": len({str(r["persona_id"]) for r in records}),
    }
    for name in MEAN_FIELDS:
        values = [float(r[name]) for r in records if r.get(name) is not None]
        if values:
            out[name] = float(np.mean(values))
            out[f"{name}_ci95"] = bootstrap_ci(values, n_boot=n_boot)
    excess = [
        float(r["excess_questions"]) for r in records if r.get("excess_questions") is not None
    ]
    if excess:
        out["excess_questions_median"] = float(np.median(excess))
        out["excess_questions_p90"] = float(np.percentile(excess, 90))
    out["boundary_violations"] = int(sum(int(bool(r.get("boundary"))) for r in records))
    for name in ("tokens", "latency_s"):
        values = [float(r[name]) for r in records if r.get(name) is not None]
        if values:
            out[f"{name}_mean"] = float(np.mean(values))
            out[f"{name}_p90"] = float(np.percentile(values, 90))
    out.update(pass_hat_k(records, k_max))
    return out


def aggregate(
    records: list[dict[str, Any]],
    by: tuple[str, ...] = ("split", "language", "area"),
    *,
    k_max: int = 8,
    n_boot: int = 1000,
) -> dict[str, Any]:
    result: dict[str, Any] = {"overall": summarize(records, k_max=k_max, n_boot=n_boot)}
    for key in by:
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for record in records:
            values = record.get(key)
            for value in values if isinstance(values, list) else [values]:
                if value is not None:
                    groups[str(value)].append(record)
        if groups:
            result[f"by_{key}"] = {
                name: summarize(group, k_max=k_max, n_boot=n_boot)
                for name, group in sorted(groups.items())
            }
    return result
