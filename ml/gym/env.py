"""AT-Benefits environment (§5.4).

Actions (dicts):
* ``{"type": "tool", "name": "office.resolve", "input": {...}}``: forwarded to the tool server;
* ``{"type": "message", "content": "..."}``: shown to the simulated user, whose reply is observed;
* ``{"type": "final", "plan": {benefits, office_per_benefit, documents_per_benefit, next_step,
  citations}}``: ends the episode and returns the §5.5 reward.

A *turn* is a message to the user or the final plan (max 12). Tool calls do not consume turns but
are capped at ``max_tool_calls`` per episode; exceeding it ends the episode without a plan.
The observation is the OpenAI-style message list so far (system, user, assistant, tool), which is
also the trajectory format written by the oracle.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from gym import slots as S
from gym.data import iter_personas
from gym.paths import DATA_DIR, from_wire_name, tool_names, wire_name
from gym.reward import RewardBreakdown, collect_urls, question_shaping, score_episode
from gym.simulator import RuleSimulator, Simulator
from gym.tools import SUBMIT_PLAN, function_defs
from gym.transport import HttpTransport, ToolResult, Transport

MAX_TURNS = 12
MAX_TOOL_CALLS = 64

SYSTEM_PROMPT = (
    "Du bist SV KI-Lotse, ein Assistent für österreichische Sozialversicherungs-Leistungen. "
    "Kläre die Situation mit wenigen, gezielten Fragen, nutze die Werkzeuge für Leistungen, "
    "zuständige Stellen und Unterlagen, und reiche am Ende mit submit_plan einen Plan ein. "
    "Jede Leistung braucht eine Quelle aus den Werkzeugen. Keine medizinischen Einschätzungen: "
    "keine Diagnosen, Dosierungen, Befundinterpretationen oder Risikobewertungen."
)


@dataclass
class EpisodeState:
    persona: dict[str, Any]
    gold: dict[str, Any]
    messages: list[dict[str, Any]] = field(default_factory=list)
    turn: int = 0
    tool_calls: int = 0
    malformed: int = 0
    questions: int = 0
    shaping: float = 0.0
    agent_texts: list[str] = field(default_factory=list)
    known: set[str] = field(default_factory=set)
    missing: set[str] = field(default_factory=set)
    observed_urls: set[str] = field(default_factory=set)
    plan: dict[str, Any] | None = None
    done: bool = False
    breakdown: RewardBreakdown | None = None
    call_seq: int = 0
    case_id: str | None = None
    subject_id: str | None = None


class AtBenefitsEnv:
    def __init__(
        self,
        transport: Transport | None = None,
        simulator: Simulator | None = None,
        *,
        max_turns: int = MAX_TURNS,
        max_tool_calls: int = MAX_TOOL_CALLS,
        system_prompt: str = SYSTEM_PROMPT,
        personas: str | Path | None = None,
        split: str | None = None,
        tools: list[dict[str, Any]] | None = None,
    ) -> None:
        self.transport = transport if transport is not None else HttpTransport()
        self.personas_path = Path(personas) if personas else DATA_DIR / "personas"
        self.split = split
        self._persona_index: dict[str, dict[str, Any]] | None = None
        self.tools = tools if tools is not None else function_defs()
        self.simulator = simulator or RuleSimulator()
        self.max_turns = max_turns
        self.max_tool_calls = max_tool_calls
        self.system_prompt = system_prompt
        self.state: EpisodeState | None = None

    # ------------------------------------------------------------------ API
    def reset(
        self, persona: dict[str, Any] | str, gold: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        if isinstance(persona, str):
            persona = self.persona(persona)
        gold = gold if gold is not None else self.transport.gold(persona)
        state = EpisodeState(persona=persona, gold=gold)
        opening = self.simulator.opening(persona)
        state.messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": opening},
        ]
        state.known = S.known_from_text(persona, opening)
        # Engine-required office context (office.resolve contract) counts as missing until known.
        state.missing = {s for s in S.OFFICE_CONTEXT_SLOTS if s not in state.known}
        engine_missing = gold.get("question_slots", gold.get("missing_slots")) or []
        state.missing |= {S.map_engine_slot(s) for s in engine_missing}
        episode = getattr(self.transport, "new_episode", lambda: None)()
        if episode:
            state.case_id = episode.get("caseId")
            state.subject_id = episode.get("subjectId")
            state.messages[0]["content"] += (
                f"\nFallkontext: caseId={state.case_id}, subjectId={state.subject_id}."
            )
        self.state = state
        return self._observation()

    def step(self, action: dict[str, Any]) -> tuple[dict[str, Any], float, bool, dict[str, Any]]:
        state = self._require()
        if state.done:
            raise RuntimeError("episode is done; call reset()")
        kind = action.get("type") if isinstance(action, dict) else None
        if kind in ("tool", "tool_call"):
            reward, info = self._tool(action)
        elif kind == "message":
            reward, info = self._message(str(action.get("content", action.get("text", ""))))
        elif kind in ("final", "final_plan"):
            reward, info = self._final(action.get("plan"))
        else:
            state.malformed += 1
            reward, info = 0.0, {"error": "unknown action type"}
        if not state.done and (
            state.turn >= self.max_turns or state.tool_calls > self.max_tool_calls
        ):
            reward += self._finish(None)
            info["truncated"] = True
        if state.done:
            info["breakdown"] = state.breakdown.as_dict() if state.breakdown else None
            if state.breakdown:
                info["boundary_flags"] = state.breakdown.boundary
                info["cite_valid"] = state.breakdown.cite_valid
                info["citations_valid"] = state.breakdown.cite_valid >= 1.0
        return self._observation(), reward, state.done, info

    # ------------------------------------------------------------ handlers
    def _tool(self, action: dict[str, Any]) -> tuple[float, dict[str, Any]]:
        state = self._require()
        state.tool_calls += 1
        name = str(action.get("name", ""))
        name = from_wire_name(name) or name
        tool_input = action.get("input")
        call_id = self._call_id()
        state.messages.append(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": wire_name(name),
                            "arguments": json.dumps(tool_input, ensure_ascii=False),
                        },
                    }
                ],
            }
        )
        if name not in tool_names() or not isinstance(tool_input, dict):
            result = ToolResult(
                ok=False, error="malformed tool call", code="MALFORMED", malformed=True
            )
        else:
            result = self.transport.call_tool(name, tool_input, case_id=state.case_id)
        if result.malformed:
            state.malformed += 1
        if result.ok:
            state.observed_urls |= collect_urls(result.output)
            self._engine_missing(name, result.output)
        elif result.code and "CONTEXT_REQUIRED" in result.code:
            state.missing |= {s for s in S.OFFICE_CONTEXT_SLOTS if s not in state.known}
        state.messages.append(
            {
                "role": "tool",
                "tool_call_id": call_id,
                "content": json.dumps(result.as_message_content(), ensure_ascii=False),
            }
        )
        return 0.0, {"tool": name, "ok": result.ok, "malformed": result.malformed, "result": result}

    def _engine_missing(self, name: str, output: Any) -> None:
        state = self._require()
        if not isinstance(output, dict):
            return
        slots: list[str] = list(output.get("missingSlots") or [])
        st = output.get("state") if isinstance(output.get("state"), dict) else output
        if isinstance(st, dict) and st.get("firstMissingSlot"):
            slots.append(st["firstMissingSlot"])
        state.missing |= {S.map_engine_slot(s) for s in slots if isinstance(s, str)}

    def _message(self, content: str) -> tuple[float, dict[str, Any]]:
        state = self._require()
        state.turn += 1
        state.agent_texts.append(content)
        dialogue = list(state.messages)
        state.messages.append({"role": "assistant", "content": content})
        shaping = 0.0
        asked: list[str] = []
        if S.is_question(content):
            state.questions += 1
            asked = S.detect_slots(content)
            shaping = question_shaping(asked, state.known, state.missing)
            state.shaping += shaping
        reply = self.simulator.reply(state.persona, dialogue, content)
        state.known |= set(asked) | set(reply.answered_slots)
        state.missing -= state.known
        state.messages.append({"role": "user", "content": reply.text})
        return shaping, {"asked_slots": asked, "reply": reply.text, "shaping": shaping}

    def _final(self, plan: Any) -> tuple[float, dict[str, Any]]:
        state = self._require()
        state.turn += 1
        call_id = self._call_id()
        state.messages.append(
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": SUBMIT_PLAN,
                            "arguments": json.dumps(plan, ensure_ascii=False),
                        },
                    }
                ],
            }
        )
        state.messages.append(
            {"role": "tool", "tool_call_id": call_id, "content": json.dumps({"ok": True})}
        )
        return self._finish(plan if plan is not None else {}), {}

    def _finish(self, plan: dict[str, Any] | None) -> float:
        state = self._require()
        state.plan = plan
        state.done = True
        state.breakdown = score_episode(
            plan,
            state.gold,
            agent_messages=state.agent_texts,
            questions=state.questions,
            malformed_tool_calls=state.malformed,
            observed_urls=state.observed_urls,
            shaping=state.shaping,
        )
        return state.breakdown.reward

    # ------------------------------------------------------------- helpers
    def _call_id(self) -> str:
        state = self._require()
        state.call_seq += 1
        return f"call_{state.call_seq}"

    def _require(self) -> EpisodeState:
        if self.state is None:
            raise RuntimeError("call reset() first")
        return self.state

    def persona(self, persona_id: str) -> dict[str, Any]:
        if self._persona_index is None:
            self._persona_index = {
                str(p.get("id")): p for p in iter_personas(self.personas_path, self.split)
            }
        return self._persona_index[persona_id]

    def _observation(self) -> dict[str, Any]:
        state = self._require()
        return {
            "messages": [dict(m) for m in state.messages],
            "tools": self.tools,
            "turn": state.turn,
            "max_turns": self.max_turns,
            "tool_calls": state.tool_calls,
            "done": state.done,
        }
