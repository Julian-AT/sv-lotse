"""verl multi-turn plumbing: the simulated user and the brain tools from the AT-Benefits gym.

``GymUserInteraction`` lets the gym's simulated user answer the policy between turns (verl
``BaseInteraction``); ``BrainTool`` forwards a tool call to the research tool server
(``packages/brain/research-server.ts``) so the policy uses the product's exact tool contract.
Both delegate to ml/gym; nothing here re-implements simulator or tool logic.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:
    sys.path.insert(0, str(ML_ROOT))

import httpx  # noqa: E402
from verl.interactions.base import BaseInteraction  # noqa: E402
from verl.tools.base_tool import BaseTool  # noqa: E402
from verl.tools.schemas import ToolResponse  # noqa: E402


def _simulator(config: dict[str, Any]):
    from gym import simulator

    cls = getattr(simulator, "SimulatedUser", None) or simulator.Simulator
    return cls(**config)


class GymUserInteraction(BaseInteraction):
    def __init__(self, config: dict[str, Any]):
        super().__init__(config)
        self.sim_config = config.get("simulator", {})
        self.max_user_turns = config.get("max_user_turns", 12)
        self.episodes: dict[str, dict[str, Any]] = {}

    async def start_interaction(self, instance_id: str | None = None, **kwargs: Any) -> str:
        persona = kwargs["persona"]
        if isinstance(persona, str):
            persona = json.loads(persona)
        self.episodes[instance_id] = {
            "user": _simulator(self.sim_config).for_persona(persona),
            "turns": 0,
        }
        return instance_id

    async def generate_response(self, instance_id: str, messages: list[dict], **kwargs: Any):
        ep = self.episodes[instance_id]
        last = next((m for m in reversed(messages) if m["role"] == "assistant"), {})
        content = last.get("content") or ""
        from eval.scoring import parse_plan

        if parse_plan(content) is not None or ep["turns"] >= self.max_user_turns:
            return True, "", 0.0, {"questions_asked": ep["turns"]}
        ep["turns"] += 1
        reply = await ep["user"].areply(messages)
        return False, reply, 0.0, {"questions_asked": ep["turns"]}

    async def calculate_score(self, instance_id: str, **kwargs: Any) -> float:
        return 0.0  # outcome reward comes from rl/reward_plugin.py

    async def finalize_interaction(self, instance_id: str, **kwargs: Any) -> None:
        self.episodes.pop(instance_id, None)


class BrainTool(BaseTool):
    """One brain tool, executed by the research tool server."""

    def __init__(self, config: dict[str, Any], tool_schema: Any):
        super().__init__(config, tool_schema)
        self.client = httpx.AsyncClient(
            base_url=config.get("server_url", "http://127.0.0.1:8787"), timeout=30
        )

    async def execute(self, instance_id: str, parameters: dict[str, Any], **kwargs: Any):
        name = self.tool_schema.function.name
        try:
            r = await self.client.post(f"/tools/{name}", json={"input": parameters})
            r.raise_for_status()
            return ToolResponse(text=json.dumps(r.json(), ensure_ascii=False)), 0.0, {}
        except httpx.HTTPError as err:
            return ToolResponse(text=json.dumps({"error": str(err)})), -0.2, {"malformed": 1}
