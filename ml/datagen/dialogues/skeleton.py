"""Skeletons: the fixed, engine-derived part of a gym oracle trajectory.

A skeleton keeps every tool call and tool output byte-for-byte and records, for each pilot
question, the slot the engine marked missing and the fact the simulated user gave. Only the text
around these fixed blocks is verbalized (tier A).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from gym import slots as S
from gym.reward import collect_urls
from gym.tools import SUBMIT_PLAN


@dataclass
class QuestionTurn:
    slot: str
    question: str  # the oracle's template question
    answer: str  # the rule simulator's answer (fact content to keep)
    value: Any  # the persona card value for the slot


@dataclass
class Source:
    n: int
    url: str
    title: str
    quote: str
    benefit_id: str | None = None


@dataclass
class Skeleton:
    id: str
    persona_id: str
    split: str
    language: str
    system: str
    opening: str
    questions: list[QuestionTurn]
    tool_block: list[dict[str, Any]]  # assistant tool_calls + tool messages, verbatim
    plan_call: dict[str, Any]  # assistant message carrying the submit_plan tool call
    plan_result: dict[str, Any]  # the tool message answering submit_plan
    plan: dict[str, Any]
    sources: list[Source] = field(default_factory=list)
    oracle_reward: dict[str, Any] = field(default_factory=dict)
    tools: list[dict[str, Any]] = field(default_factory=list)

    @property
    def observed_urls(self) -> set[str]:
        urls: set[str] = set()
        for message in self.tool_block:
            if message.get("role") == "tool":
                try:
                    urls |= collect_urls(json.loads(message.get("content") or "null"))
                except json.JSONDecodeError:
                    continue
        return urls


def _is_tool_call(message: dict[str, Any]) -> bool:
    return message.get("role") == "assistant" and bool(message.get("tool_calls"))


def _call_name(message: dict[str, Any]) -> str:
    return str(message["tool_calls"][0]["function"]["name"])


def extract_sources(tool_block: list[dict[str, Any]], plan: dict[str, Any], limit: int = 24):
    """Numbered sources (URL, title, quote) from tool outputs, preferring the plan's benefits and
    the plan's citations. Only URLs that a tool actually returned are ever listed."""
    benefits = set(plan.get("benefits") or [])
    cited = [c for c in plan.get("citations") or [] if isinstance(c, str)]
    found: dict[str, Source] = {}
    for message in tool_block:
        if message.get("role") != "tool":
            continue
        try:
            body = json.loads(message.get("content") or "null")
        except json.JSONDecodeError:
            continue
        output = body.get("output") if isinstance(body, dict) else None
        items = output if isinstance(output, list) else [output] if isinstance(output, dict) else []
        for item in items:
            if not isinstance(item, dict):
                continue
            bid = item.get("id") if isinstance(item.get("id"), str) else None
            title = str(item.get("title") or item.get("name") or bid or "")
            for src in item.get("sources") or []:
                if not isinstance(src, dict) or not src.get("url"):
                    continue
                url = str(src["url"]).strip()
                if url in found:
                    continue
                found[url] = Source(0, url, title, str(src.get("quote") or "")[:300], bid)
    order: list[str] = []
    for benefit in plan.get("benefits") or []:  # one source per plan benefit first
        first = next((u for u, s in found.items() if s.benefit_id == benefit), None)
        if first and first not in order:
            order.append(first)
    order += [u for u in cited if u in found and u not in order]
    order += [u for u, s in found.items() if u not in order and s.benefit_id in benefits]
    order += [u for u in found if u not in order]
    out = []
    for i, url in enumerate(order[:limit], start=1):
        src = found[url]
        src.n = i
        out.append(src)
    return out


def from_oracle(record: dict[str, Any], persona: dict[str, Any] | None = None) -> Skeleton | None:
    """Parse one oracle trajectory (``gym.oracle`` JSONL record). None when it has no plan."""
    messages: list[dict[str, Any]] = record["messages"]
    if len(messages) < 3 or messages[0].get("role") != "system":
        return None
    system, opening = messages[0]["content"], messages[1]["content"]
    questions: list[QuestionTurn] = []
    tool_block: list[dict[str, Any]] = []
    plan_call = plan_result = None
    i = 2
    while i < len(messages):
        m = messages[i]
        if _is_tool_call(m):
            if _call_name(m) == SUBMIT_PLAN:
                plan_call = m
                plan_result = messages[i + 1] if i + 1 < len(messages) else None
                i += 2
                continue
            tool_block.append(m)
            if i + 1 < len(messages) and messages[i + 1].get("role") == "tool":
                tool_block.append(messages[i + 1])
                i += 1
        elif m.get("role") == "assistant" and m.get("content") and not tool_block:
            reply = messages[i + 1]["content"] if i + 1 < len(messages) else ""
            slots = S.detect_slots(m["content"])
            slot = slots[0] if slots else "other"
            value = S.slot_value(persona, slot) if persona else None
            questions.append(QuestionTurn(slot, m["content"], reply, value))
            i += 1
        i += 1
    if plan_call is None or plan_result is None:
        return None
    plan = json.loads(plan_call["tool_calls"][0]["function"]["arguments"] or "{}")
    return Skeleton(
        id=str(record.get("id") or f"oracle-{record.get('persona_id')}"),
        persona_id=str(record.get("persona_id")),
        split=str(record.get("split")),
        language=str(record.get("language") or "de"),
        system=system,
        opening=opening,
        questions=questions,
        tool_block=tool_block,
        plan_call=plan_call,
        plan_result=plan_result,
        plan=plan,
        sources=extract_sources(tool_block, plan),
        oracle_reward=record.get("reward") or {},
        tools=record.get("tools") or [],
    )


def iter_oracle(path: str | Path) -> Iterator[dict[str, Any]]:
    with Path(path).open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)
