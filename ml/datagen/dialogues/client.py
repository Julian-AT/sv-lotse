"""Helpers around the shared datagen core (``datagen.llm``)."""

from __future__ import annotations

import json
from typing import Any

from datagen.llm import LLM, BudgetExceeded, QuotaError

STOP_ERRORS = (BudgetExceeded, QuotaError)


def get_llm(family: str = "dialogues", **kwargs: Any) -> LLM:
    return LLM(family, **kwargs)


def parsed_json(result: Any) -> Any:
    """The structured reply of a ``ChatResult`` (``parsed`` or the JSON in ``text``)."""
    if getattr(result, "error", None):
        raise ValueError(f"llm error: {result.error}")
    parsed = getattr(result, "parsed", None)
    if parsed is not None:
        return parsed
    text = getattr(result, "text", None) or ""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


def usage_tokens(result: Any) -> int:
    """Prompt + completion tokens of one result (0 for cache hits)."""
    if getattr(result, "cached", False):
        return 0
    usage = getattr(result, "usage", None) or {}
    total = usage.get("total_tokens")
    if total is None:
        total = sum(
            int(usage.get(k) or 0)
            for k in ("input_tokens", "output_tokens", "prompt_tokens", "completion_tokens")
        )
    return int(total or 0)


def remaining_tokens(llm: Any) -> float | None:
    """Tokens left in the family's pool (``LLM.remaining()["family"]``)."""
    try:
        r = llm.remaining()
    except Exception:  # noqa: BLE001
        return None
    if isinstance(r, dict):
        value = r.get("family", r.get("tokens"))
        return float(value) if isinstance(value, (int, float)) else None
    return float(r) if isinstance(r, (int, float)) else None
