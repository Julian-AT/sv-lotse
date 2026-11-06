"""Fake model replies for tests and ``--fake`` smoke runs: the core ``LLM`` with the core
``FakeTransport`` (no network). Replies are chosen by the system prompt of the request."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from datagen.llm import LLM
from datagen.transport import FakeTransport


def tier_a_reply(messages: list[dict[str, Any]]) -> dict[str, Any]:
    task = json.loads(messages[-1]["content"])
    safety = "Safety turn" in messages[0]["content"]
    first = task["sources"][0]["n"] if task["sources"] else 1
    benefits = ", ".join(b["title"] for b in task["plan"]["benefits"])
    return {
        "opening": task["original_opening"],
        "turns": [
            {"slot": q["slot"], "question": q["reference_question"], "answer": q["fact_in_answer"]}
            for q in task["questions"]
        ],
        "explanation": f"Nach den Unterlagen kann Folgendes in Frage kommen: {benefits} [{first}].",
        "user_reaction": "Danke, das hilft mir.",
        "plan_summary": "Als Nächstes stellen Sie den Antrag bei der zuständigen Stelle.",
        "safety": {
            "user": "Soll ich meine Tabletten weiter nehmen?" if safety else "",
            "pilot": (
                "Dazu kann ich nichts sagen. Bitte fragen Sie Ihre Ärztin oder rufen Sie 1450 an."
                if safety
                else ""
            ),
        },
    }


def judge_reply(messages: list[dict[str, Any]]) -> dict[str, Any]:
    ids = [
        line.split(":")[0].strip("- ")
        for line in messages[0]["content"].splitlines()
        if line.startswith("- ")
    ]
    return {
        "scores": [{"criterion": c, "score": 5} for c in ids],
        "passed": True,
        "reason": "fake",
    }


def responder(
    teacher: Callable[[list[dict[str, Any]]], dict[str, Any]] | None = None,
    user: str = "Steiermark.",
) -> Callable[[dict[str, Any]], str]:
    def reply(body: dict[str, Any]) -> str:
        messages = body["messages"]
        system = messages[0]["content"]
        if "You write realistic dialogues" in system:
            return json.dumps(tier_a_reply(messages), ensure_ascii=False)
        if "data-quality judge" in system:
            return json.dumps(judge_reply(messages))
        if "You act through JSON actions" in system and teacher is not None:
            action = {"name": "", "arguments_json": "", "content": "", "plan_json": ""}
            action.update(teacher(messages))
            return json.dumps(action, ensure_ascii=False)
        return user

    return reply


def fake_llm(teacher=None, user: str = "Steiermark.", **kwargs: Any) -> LLM:
    transport = FakeTransport(responder(teacher, user), batch_api=False)
    return LLM("dialogues", transport=transport, **kwargs)
