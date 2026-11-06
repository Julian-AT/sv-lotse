"""Re-score any finished dialogue with the gym reward (§5.5) and the product boundary patterns.

The plan is read from the ``submit_plan`` tool call, the gold from the persona (engine), the
observed source URLs from the tool messages. Nothing here is judged by a model.
"""

from __future__ import annotations

import json
import re
from typing import Any

from gym import slots as S
from gym.guards import check_boundary
from gym.reward import collect_urls, score_episode
from gym.tools import SUBMIT_PLAN

MARKER = re.compile(r"\[(\d{1,2})\]")


def plan_of(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for m in reversed(messages):
        for call in m.get("tool_calls") or []:
            if call["function"]["name"] == SUBMIT_PLAN:
                try:
                    return json.loads(call["function"]["arguments"] or "null")
                except json.JSONDecodeError:
                    return None
    return None


def observed_urls(messages: list[dict[str, Any]]) -> set[str]:
    urls: set[str] = set()
    for m in messages:
        if m.get("role") == "tool":
            try:
                urls |= collect_urls(json.loads(m.get("content") or "null"))
            except json.JSONDecodeError:
                continue
    return urls


def agent_texts(messages: list[dict[str, Any]]) -> list[str]:
    return [m["content"] for m in messages if m.get("role") == "assistant" and m.get("content")]


def malformed_calls(messages: list[dict[str, Any]]) -> int:
    n = 0
    for m in messages:
        if m.get("role") != "tool":
            continue
        try:
            body = json.loads(m.get("content") or "null")
        except json.JSONDecodeError:
            continue
        err = body.get("error") if isinstance(body, dict) else None
        if isinstance(err, dict) and str(err.get("code") or "").upper() == "MALFORMED":
            n += 1
    return n


def rescore(messages: list[dict[str, Any]], gold: dict[str, Any]) -> dict[str, Any]:
    """Gym reward breakdown of a dialogue plus boundary hits per assistant turn."""
    texts = agent_texts(messages)
    breakdown = score_episode(
        plan_of(messages),
        gold,
        agent_messages=texts,
        questions=sum(S.is_question(t) for t in texts),
        malformed_tool_calls=malformed_calls(messages),
        observed_urls=observed_urls(messages),
    ).as_dict()
    breakdown["citations_valid"] = breakdown["cite_valid"] >= 1.0
    return breakdown


def boundary_hits(texts: list[str]) -> list[dict[str, str]]:
    return [hit for text in texts for hit in check_boundary(text)]


def accepted(breakdown: dict[str, Any], min_reward: float = 0.9) -> bool:
    return (
        breakdown["reward"] >= min_reward
        and breakdown["boundary"] == 0
        and breakdown["cite_valid"] >= 1.0
        and breakdown["uncited"] == 0
    )
