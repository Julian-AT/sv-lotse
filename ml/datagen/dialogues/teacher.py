"""Tier B: the strong model plays the pilot in the gym against the LLM simulated user, with the
real brain tools from the research tool server. Rejection sampling as in ``sft.rollout``: kept
only with gym reward R >= 0.9, zero boundary flags (product rule patterns) and valid citations.

The teacher answers with one JSON action per step (tool call, message or final plan), so the
protocol works with any chat endpoint; the stored dialogue is the gym's own OpenAI-style message
list (tool calls with ``lotse_*`` wire names, exact tool outputs).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from datagen.dialogues.client import parsed_json
from datagen.dialogues.score import rescore
from gym import slots as S
from gym.env import AtBenefitsEnv
from gym.paths import from_wire_name
from gym.simulator import SIM_SYSTEM, SimReply, persona_card
from gym.tools import SUBMIT_PLAN
from gym.transport import Transport
from sft.rollout import keep

TOOL_VIEW_CHARS = 6000
VIEW_KEYS = (
    "ok",
    "error",
    "code",
    "message",
    "output",
    "id",
    "title",
    "type",
    "status",
    "required",
    "criteria",
    "sources",
    "url",
    "text",
    "name",
)


def _keep(value: Any, depth: int = 0) -> Any:
    if isinstance(value, dict):
        out = {k: _keep(v, depth + 1) for k, v in value.items() if k in VIEW_KEYS}
        if "text" in out and isinstance(out["text"], str):
            out["text"] = out["text"][:200]
        return out
    if isinstance(value, list):
        return [_keep(v, depth + 1) for v in value[:30]]
    return value


def compact(content: str | None) -> str:
    """Tool output for the teacher's context: ids, titles, statuses, criteria and source URLs
    (descriptions and quotes dropped so long episodes stay affordable). The stored dialogue keeps
    the exact output."""
    try:
        text = json.dumps(_keep(json.loads(content or "null")), ensure_ascii=False)
    except json.JSONDecodeError:
        text = content or ""
    return text if len(text) <= TOOL_VIEW_CHARS else text[:TOOL_VIEW_CHARS] + " …[truncated]"


TEACHER_RULES = """
You act through JSON actions only. Each reply is exactly one action:
- {{"type":"tool","name":"<tool>","arguments_json":"<JSON object>","content":"","plan_json":""}}
- {{"type":"message","name":"","arguments_json":"","content":"<text to the user>","plan_json":""}}
- {{"type":"final","name":"","arguments_json":"","content":"","plan_json":"<plan JSON>"}}
Tools (name: JSON schema of the arguments):
{tools}
Final plan JSON: {{"benefits":[ids], "office_per_benefit":{{id: office id}},
"documents_per_benefit":{{id: [document ids]}}, "next_step":{{"benefitId": id}},
"citations":[source URLs returned by tools]}}.
Plan convention of the product engine: list EVERY benefit that lotse_catalog_findBenefits returns
for the person's life situation unless one of its criteria has status "not_met" (unknown counts as
possibly eligible); call lotse_office_resolve and lotse_documents_checklist for each of them; put
the required documents' "type" values into documents_per_benefit; next_step.benefitId is the
benefit that answers the person's main question.
{context}
Workflow: ask only for facts you need and that the person has not said (state, insurance carrier,
insurance status, and what a process step reports missing), one short question per message.
Then call lotse_catalog_findBenefits, then lotse_office_resolve and lotse_documents_checklist per
benefit, explain the benefits that may apply with source markers [1], [2] and the URLs, then submit
the final plan. Use only ids and URLs that tools returned. Write to the person in {language}.
GRADING: the final plan is graded for completeness against the engine. Include every benefit the
last lotse_catalog_findBenefits call returned (except criteria with status "not_met"), each with
its resolved office and required document types, even if it is only loosely related; in your
explanation name the main benefit first and the others as "may also apply, the office checks".
Never give medical judgements (no diagnosis, finding interpretation, risk assessment, therapy or
medicine advice); for medical questions refer to the treating doctor or the health hotline 1450.
"""

ACTION_SCHEMA = {
    "type": "json_schema",
    "json_schema": {
        "name": "action",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["tool", "message", "final"]},
                "name": {"type": "string"},
                "arguments_json": {"type": "string"},
                "content": {"type": "string"},
                "plan_json": {"type": "string"},
            },
            "required": ["type", "name", "arguments_json", "content", "plan_json"],
            "additionalProperties": False,
        },
    },
}


class LLMUser:
    """Simulated user (§5.3) through the datagen core: sees only the persona card and dialogue."""

    def __init__(self, llm: Any, role: str = "bulk") -> None:
        self.llm, self.role = llm, role

    def opening(self, persona: dict[str, Any]) -> str:
        return str(persona.get("situation_text") or "")

    def reply(self, persona: dict[str, Any], dialogue: list[dict[str, Any]], message: str):
        member = S.speaker(persona)
        noise = persona.get("noise") or {}
        system = SIM_SYSTEM.format(
            language=member.get("language", "de-AT"),
            register=member.get("register", "neutral"),
            partial=noise.get("partial_knowledge", 0.0),
            contradiction=noise.get("contradiction", 0.0),
            dialect=noise.get("dialect", 0.0),
            card=json.dumps(persona_card(persona), ensure_ascii=False),
        )
        chat: list[dict[str, Any]] = [{"role": "system", "content": system}]
        for turn in dialogue:
            if turn["role"] == "user":
                chat.append({"role": "assistant", "content": turn["content"]})
            elif turn["role"] == "assistant" and turn.get("content"):
                chat.append({"role": "user", "content": turn["content"]})
        chat.append({"role": "user", "content": message})
        result = self.llm.chat(chat, role=self.role, max_output_tokens=600)
        asked = S.detect_slots(message) if S.is_question(message) else []
        return SimReply(text=(result.text or "").strip(), answered_slots=asked, asked_slots=asked)


def catalog_context(summary: dict[str, Any] | None) -> str:
    """Engine vocabulary for tool arguments (from the research server's GET /catalog/summary)."""
    if not summary:
        return ""
    v = summary.get("vocabulary") or {}
    return (
        "Argument vocabulary: lifeSituation one of "
        + json.dumps(summary.get("life_situations") or v.get("life_situations"))
        + "; carrier one of "
        + json.dumps(v.get("carriers"))
        + "; region = federal state, one of "
        + json.dumps(v.get("states"))
        + "; subjectStatus one of "
        + json.dumps(v.get("statuses"))
        + ' or "pensioner:<pension carrier>" (pension carriers '
        + json.dumps(v.get("pension_carriers"))
        + "); findBenefits subject.status uses the plain status; ageBand is the age in years."
    )


def teacher_view(
    messages: list[dict[str, Any]], tools: list[dict[str, Any]], language: str, context: str = ""
):
    """The env messages rendered for a JSON-action teacher (tool outputs truncated)."""
    tool_lines = "\n".join(
        f"{t['function']['name']}: {json.dumps(t['function'].get('parameters'))}"
        for t in tools
        if t["function"]["name"] != SUBMIT_PLAN
    )
    system = messages[0]["content"] + TEACHER_RULES.format(
        tools=tool_lines, language=language, context=context
    )
    out: list[dict[str, Any]] = [{"role": "system", "content": system}]
    for m in messages[1:]:
        if m["role"] == "user":
            out.append({"role": "user", "content": m["content"]})
        elif m["role"] == "assistant" and m.get("tool_calls"):
            f = m["tool_calls"][0]["function"]
            out.append({"role": "assistant", "content": f"TOOL {f['name']} {f['arguments']}"})
        elif m["role"] == "assistant":
            out.append({"role": "assistant", "content": m.get("content") or ""})
        elif m["role"] == "tool":
            out.append({"role": "user", "content": f"TOOL RESULT: {compact(m.get('content'))}"})
    return out


def to_action(raw: dict[str, Any]) -> dict[str, Any]:
    kind = raw.get("type")
    if kind == "tool":
        name = str(raw.get("name") or "")
        try:
            args = json.loads(raw.get("arguments_json") or "{}")
        except json.JSONDecodeError:
            args = None
        if name == SUBMIT_PLAN:
            return {"type": "final", "plan": args}
        return {"type": "tool", "name": from_wire_name(name) or name, "input": args}
    if kind == "final":
        try:
            plan = json.loads(raw.get("plan_json") or "{}")
        except json.JSONDecodeError:
            plan = None
        return {"type": "final", "plan": plan}
    return {"type": "message", "content": str(raw.get("content") or "")}


@dataclass
class Episode:
    persona_id: str
    messages: list[dict[str, Any]]
    done: bool
    breakdown: dict[str, Any]
    kept: bool
    steps: int
    tokens: int


def play(
    llm: Any,
    transport: Transport,
    persona: dict[str, Any],
    *,
    max_steps: int = 60,
    role: str = "strong",
    context: str = "",
) -> Episode:
    from datagen.dialogues.client import usage_tokens

    env = AtBenefitsEnv(transport, LLMUser(llm))
    obs = env.reset(persona, gold=persona.get("gold"))
    lang = S.language(persona)
    tokens, done, steps = 0, False, 0
    while not done and steps < max_steps:
        steps += 1
        view = teacher_view(obs["messages"], obs["tools"], lang, context)
        result = llm.chat(view, role=role, response_format=ACTION_SCHEMA, max_output_tokens=1500)
        tokens += usage_tokens(result)
        try:
            action = to_action(parsed_json(result))
        except (ValueError, TypeError):
            action = {"type": "message", "content": ""}
        obs, _, done, _ = env.step(action)
    state = env.state
    assert state is not None
    breakdown = rescore(state.messages, state.gold) if done else {}
    traj = {
        "done": done,
        "reward": breakdown.get("reward", 0.0),
        "boundary_flags": breakdown.get("boundary", 1),
        "citations_valid": breakdown.get("citations_valid", False),
    }
    kept = keep(traj) and done and breakdown.get("uncited", 1) == 0
    return Episode(str(persona.get("id")), state.messages, done, breakdown, kept, steps, tokens)
