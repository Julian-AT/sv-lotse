"""Simulated users (§5.3). Both see only the persona card (gold removed) and the dialogue.

* ``RuleSimulator``: deterministic; answers only the slots a question asks for, from the persona
  card, with seeded noise. Used for tests and oracle rollouts.
* ``LLMSimulator``: an OpenAI-compatible chat endpoint (vLLM or frontier). Configured through
  ``LOTSE_SIM_BASE_URL``, ``LOTSE_SIM_MODEL`` and ``LOTSE_SIM_API_KEY``.
"""

from __future__ import annotations

import json
import os
import random
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from gym import slots as S

HIDDEN_FROM_USER = frozenset(
    {"gold", "split", "id", "goal", "life_situation", "opening_facts", "family", "area"}
)


def persona_card(persona: dict[str, Any]) -> dict[str, Any]:
    """What the simulated user may know: the persona without gold, split metadata or the goal id
    (a catalog id would leak the answer; the user's goal is in ``situation_text``)."""
    return {k: v for k, v in persona.items() if k not in HIDDEN_FROM_USER}


@dataclass
class SimReply:
    text: str
    answered_slots: list[str] = field(default_factory=list)
    asked_slots: list[str] = field(default_factory=list)


class Simulator(Protocol):
    def opening(self, persona: dict[str, Any]) -> str: ...

    def reply(
        self, persona: dict[str, Any], dialogue: list[dict[str, Any]], message: str
    ) -> SimReply: ...


@dataclass
class RuleSimulator:
    """Answers slot questions from the persona card. ``noise=False`` gives clean answers."""

    noise: bool = True
    seed: int = 0

    def opening(self, persona: dict[str, Any]) -> str:
        return str(persona.get("situation_text") or "")

    def _rng(self, persona: dict[str, Any], turn: int) -> random.Random:
        return random.Random(f"{self.seed}:{persona.get('id')}:{turn}")

    def reply(
        self, persona: dict[str, Any], dialogue: list[dict[str, Any]], message: str
    ) -> SimReply:
        lang = S.language(persona)
        asked = S.detect_slots(message) if S.is_question(message) else []
        if not asked:
            ack = {"de": "Okay, danke.", "en": "Okay, thanks.", "tr": "Tamam, teşekkürler."}
            return SimReply(text=ack.get(lang, ack["de"]))
        noise = persona.get("noise") or {}
        rng = self._rng(persona, len(dialogue))
        parts: list[str] = []
        answered: list[str] = []
        for slot in asked[:2]:
            value = S.slot_value(persona, slot)
            if self.noise and rng.random() < float(noise.get("partial_knowledge", 0.0)):
                parts.append(S.ANSWERS.get(lang, S.ANSWERS["de"])["_unknown"])
                continue
            answer = S.answer_for(slot, value, lang)
            wrong = [v for v in S.ALTERNATIVES.get(slot, ()) if v != value]
            if self.noise and wrong and rng.random() < float(noise.get("contradiction", 0.0)):
                first = S.answer_for(slot, rng.choice(wrong), lang)
                correction = {"de": "Nein, Moment: ", "en": "No, wait: ", "tr": "Hayır, dur: "}
                parts.append(f"{first} {correction.get(lang, correction['de'])}{answer}")
            else:
                parts.append(answer)
            answered.append(slot)
        text = " ".join(parts)
        if self.noise and lang == "de" and rng.random() < float(noise.get("dialect", 0.0)):
            text = "Najo, " + text[0].lower() + text[1:]
        return SimReply(text=text, answered_slots=answered, asked_slots=asked)


SIM_SYSTEM = """You play a person asking an Austrian social-insurance assistant for help.
Your persona card (JSON) is below. Rules:
- Stay in character; speak {language} in the register "{register}".
- Answer ONLY what the assistant asks. Never volunteer other facts from the card.
- Never name benefits, offices or documents you were not told about; you do not know the answer.
- Noise: with probability {partial} say you do not know a fact; with probability {contradiction}
  first state a wrong value and correct yourself; dialect strength {dialect} (0-1).
- Keep answers short (1-2 sentences). If the assistant gives you a final plan, thank them.
Persona card:
{card}"""


@dataclass
class LLMSimulator:
    base_url: str = field(default_factory=lambda: os.environ.get("LOTSE_SIM_BASE_URL", ""))
    model: str = field(default_factory=lambda: os.environ.get("LOTSE_SIM_MODEL", ""))
    api_key: str = field(default_factory=lambda: os.environ.get("LOTSE_SIM_API_KEY", "EMPTY"))
    temperature: float = 0.7
    timeout: float = 120.0

    def __post_init__(self) -> None:
        if not self.base_url or not self.model:
            raise ValueError("LOTSE_SIM_BASE_URL and LOTSE_SIM_MODEL must be set for LLMSimulator")
        self._client = httpx.Client(
            base_url=self.base_url.rstrip("/"),
            timeout=self.timeout,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )

    def system_prompt(self, persona: dict[str, Any]) -> str:
        member = S.speaker(persona)
        noise = persona.get("noise") or {}
        return SIM_SYSTEM.format(
            language=member.get("language", "de-AT"),
            register=member.get("register", "neutral"),
            partial=noise.get("partial_knowledge", 0.0),
            contradiction=noise.get("contradiction", 0.0),
            dialect=noise.get("dialect", 0.0),
            card=json.dumps(persona_card(persona), ensure_ascii=False),
        )

    def opening(self, persona: dict[str, Any]) -> str:
        return str(persona.get("situation_text") or "")

    def reply(
        self, persona: dict[str, Any], dialogue: list[dict[str, Any]], message: str
    ) -> SimReply:
        # Roles are mirrored: the simulator is the "assistant" of its own chat.
        messages: list[dict[str, str]] = [
            {"role": "system", "content": self.system_prompt(persona)}
        ]
        for turn in dialogue:
            if turn["role"] == "user":
                messages.append({"role": "assistant", "content": turn["content"]})
            elif turn["role"] == "assistant" and turn.get("content"):
                messages.append({"role": "user", "content": turn["content"]})
        messages.append({"role": "user", "content": message})
        response = self._client.post(
            "/chat/completions",
            json={"model": self.model, "messages": messages, "temperature": self.temperature},
        )
        response.raise_for_status()
        text = response.json()["choices"][0]["message"]["content"] or ""
        asked = S.detect_slots(message) if S.is_question(message) else []
        return SimReply(text=text.strip(), answered_slots=list(asked), asked_slots=asked)


@dataclass
class BoundUser:
    simulator: Simulator
    persona: dict[str, Any]

    def reply(self, messages: list[dict[str, Any]]) -> str:
        last = next((m for m in reversed(messages) if m.get("role") == "assistant"), {})
        dialogue = messages[: messages.index(last)] if last in messages else list(messages)
        return self.simulator.reply(self.persona, dialogue, last.get("content") or "").text

    async def areply(self, messages: list[dict[str, Any]]) -> str:
        import asyncio

        return await asyncio.to_thread(self.reply, messages)


class SimulatedUser:
    """Factory used by the RL interaction: ``SimulatedUser(kind="rule"|"llm", **cfg)``."""

    def __init__(self, kind: str = "rule", **config: Any) -> None:
        self.simulator: Simulator = (
            LLMSimulator(**config) if kind == "llm" else RuleSimulator(**config)
        )

    def for_persona(self, persona: dict[str, Any]) -> BoundUser:
        return BoundUser(self.simulator, persona)
