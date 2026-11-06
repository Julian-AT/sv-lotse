"""verl custom reward function: scores the agent's final plan with the AT-Benefits gym reward.

Wired in the GRPO configs as ``custom_reward_function: {path: rl/reward_plugin.py, name:
compute_score}``. The reward formula lives in ml/gym/reward.py (lotse-rl.md §5.5); this plugin only
extracts the final plan from the rollout and forwards the episode statistics that the multi-turn
interaction recorded (boundary flags, questions asked, malformed tool calls) in ``extra_info``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ML_ROOT = Path(__file__).resolve().parents[1]
if str(ML_ROOT) not in sys.path:  # verl loads this file by path
    sys.path.insert(0, str(ML_ROOT))

from eval.scoring import parse_last_plan, score_plan  # noqa: E402


def compute_score(
    data_source: str,
    solution_str: str,
    ground_truth: str | dict[str, Any],
    extra_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    gold = json.loads(ground_truth) if isinstance(ground_truth, str) else ground_truth
    extra = extra_info or {}
    persona = {"id": extra.get("persona_id"), "gold": gold}
    out = score_plan(
        parse_last_plan(solution_str),
        persona,
        agent_messages=extra.get("agent_messages") or [solution_str],
        questions=int(extra.get("questions_asked", 0)),
        malformed_tool_calls=int(extra.get("malformed_tool_calls", 0)),
    )
    # verl expects a "score" key when a dict is returned; the rest is logged per component.
    numeric = {k: v for k, v in out.items() if isinstance(v, int | float) and k != "reward"}
    return {"score": out["reward"], **numeric}
