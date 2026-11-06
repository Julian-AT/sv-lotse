"""Adapter from a final plan to the AT-Benefits gym reward (ml/gym/reward.py).

The reward itself lives in the gym (``score_episode``); this module only parses plans out of model
output and returns the breakdown as a dict with ``reward`` = total.
"""

from __future__ import annotations

import json
import re
from typing import Any


def score_plan(
    plan: dict[str, Any] | None,
    persona: dict[str, Any],
    *,
    agent_messages: list[str] | None = None,
    questions: int = 0,
    malformed_tool_calls: int = 0,
    observed_urls: set[str] | None = None,
) -> dict[str, Any]:
    """Score a parsed plan (None = no parseable plan) with ``gym.reward.score_episode``.

    Returns the gym's reward breakdown with ``reward`` set to the total (reward + shaping).
    """
    from gym.reward import score_episode  # ml/gym, not the OpenAI package

    result = score_episode(
        plan,
        persona["gold"],
        agent_messages=agent_messages or [],
        questions=questions,
        malformed_tool_calls=malformed_tool_calls,
        observed_urls=observed_urls,
    )
    out = result.as_dict()
    out["reward"] = float(out["total"])
    out["no_plan"] = plan is None
    return out


_THINK = re.compile(r"<think>.*?</think>", re.S)


def parse_plan(text: str) -> dict[str, Any] | None:
    """First balanced JSON object in the model output, if it parses to a dict with benefits."""
    text = _THINK.sub("", text)
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            c = text[i]
            if in_str:
                if esc:
                    esc = False
                elif c == "\\":
                    esc = True
                elif c == '"':
                    in_str = False
                continue
            if c == '"':
                in_str = True
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
                    if isinstance(obj, dict) and "benefits" in obj:
                        return obj
                    break
        start = text.find("{", start + 1)
    return None


def parse_last_plan(text: str) -> dict[str, Any] | None:
    """The last final plan in a multi-turn transcript (earlier JSON may be tool arguments)."""
    text = _THINK.sub("", text)
    pos = len(text)
    while (i := text.rfind("{", 0, pos)) != -1:
        if (plan := parse_plan(text[i:])) is not None:
            return plan
        pos = i
    return None
