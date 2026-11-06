"""Teacher rollouts in the AT-Benefits gym with rejection sampling (lotse-rl.md §7.1, S2).

A frontier teacher (any OpenAI-compatible chat endpoint) plays gym episodes with the real brain
tools. A trajectory is kept only if the gym scores it R >= 0.9, it has zero boundary flags and all
citations are valid. Kept trajectories are written as chat transcripts that sft.train consumes.

    uv run python -m sft.rollout --teacher gpt-5 --n 120000 --out data/sft/teacher.jsonl

Needs the research tool server and an API key in the environment (OPENAI_API_KEY or
TEACHER_API_KEY, base URL in TEACHER_BASE_URL). Not run for the hackathon: the API budget is spent.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import time
from pathlib import Path
from typing import Any

import httpx

from sft.data import load_personas
from sft.results import ML_ROOT, file_hash, write_result

MIN_REWARD = 0.9


def make_env(**kwargs: Any):
    """The gym environment built by the gym lane (ml/gym)."""
    from gym import env as gym_env

    for name in ("AtBenefitsEnv", "ATBenefitsEnv", "BenefitsEnv", "Env"):
        cls = getattr(gym_env, name, None)
        if cls is not None:
            return cls(**kwargs)
    if callable(getattr(gym_env, "make", None)):
        return gym_env.make(**kwargs)
    raise ImportError("gym.env exposes no environment class")


class Teacher:
    def __init__(self, model: str, temperature: float):
        self.model = model
        self.temperature = temperature
        key = os.environ.get("TEACHER_API_KEY") or os.environ.get("OPENAI_API_KEY")
        if not key:
            raise SystemExit("set TEACHER_API_KEY or OPENAI_API_KEY")
        self.client = httpx.Client(
            base_url=os.environ.get("TEACHER_BASE_URL", "https://api.openai.com/v1"),
            headers={"Authorization": f"Bearer {key}"},
            timeout=120,
        )

    def __call__(self, messages: list[dict], tools: list[dict]) -> dict[str, Any]:
        body = {"model": self.model, "messages": messages, "temperature": self.temperature}
        if tools:
            body["tools"] = tools
        for attempt in range(5):
            r = self.client.post("/chat/completions", json=body)
            if r.status_code in {429, 500, 502, 503}:
                time.sleep(2**attempt)
                continue
            r.raise_for_status()
            return r.json()["choices"][0]["message"]
        r.raise_for_status()
        return {}


def _step(env: Any, action: dict[str, Any]) -> tuple[Any, float, bool, dict]:
    out = env.step(action)
    obs, reward, done, *rest = out
    info = rest[-1] if rest and isinstance(rest[-1], dict) else {}
    return obs, float(reward or 0.0), bool(done), info


def _action_from_message(msg: dict[str, Any]) -> dict[str, Any]:
    """Map a teacher message to a gym action: tool call, final plan or message to the user."""
    if msg.get("tool_calls"):
        call = msg["tool_calls"][0]
        return {
            "type": "tool_call",
            "id": call.get("id"),
            "name": call["function"]["name"],
            "input": json.loads(call["function"].get("arguments") or "{}"),
        }
    content = msg.get("content") or ""
    from eval.scoring import parse_plan

    plan = parse_plan(content)
    if plan is not None:
        return {"type": "final_plan", "plan": plan}
    return {"type": "message", "text": content}


def rollout(env: Any, teacher: Teacher, persona_id: str, max_turns: int) -> dict[str, Any]:
    obs = env.reset(persona_id)
    obs = obs[0] if isinstance(obs, tuple) else obs
    messages = (
        list(obs["messages"])
        if isinstance(obs, dict) and "messages" in obs
        else [{"role": "user", "content": str(obs)}]
    )
    tools = obs.get("tools", []) if isinstance(obs, dict) else []
    total, info, done = 0.0, {}, False
    for _ in range(max_turns * 4):  # tool calls do not count as user turns
        msg = teacher(messages, tools)
        messages.append({k: v for k, v in msg.items() if k in {"role", "content", "tool_calls"}})
        action = _action_from_message(msg)
        obs, reward, done, info = _step(env, action)
        total += reward
        if done:
            break
        if action["type"] == "tool_call":
            messages.append(
                {"role": "tool", "tool_call_id": action["id"], "content": json.dumps(obs)}
            )
        else:
            text = obs.get("text") if isinstance(obs, dict) else obs
            messages.append({"role": "user", "content": str(text)})
    return {
        "persona_id": persona_id,
        "messages": messages,
        "tools": tools,
        "done": done,
        "reward": total,
        "boundary_flags": int(info.get("boundary_flags", info.get("boundary_violations", 0))),
        "citations_valid": bool(info.get("citations_valid", info.get("cite_valid", 0) >= 1)),
        "info": info,
    }


def keep(traj: dict[str, Any], min_reward: float = MIN_REWARD) -> bool:
    return (
        traj["done"]
        and traj["reward"] >= min_reward
        and traj["boundary_flags"] == 0
        and traj["citations_valid"]
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--teacher", required=True)
    ap.add_argument("--n", type=int, default=1000, help="episodes to attempt")
    ap.add_argument("--samples-per-persona", type=int, default=2)
    ap.add_argument("--personas", type=Path, default=ML_ROOT / "data/personas")
    ap.add_argument("--split", default="train")
    ap.add_argument("--out", type=Path, default=ML_ROOT / "data/sft/teacher.jsonl")
    ap.add_argument("--max-turns", type=int, default=12)
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--min-reward", type=float, default=MIN_REWARD)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    personas = load_personas(args.personas, [args.split])
    random.Random(args.seed).shuffle(personas)
    env, teacher = make_env(split=args.split), Teacher(args.teacher, args.temperature)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    attempted = kept = 0
    rejects = {"reward": 0, "boundary": 0, "citations": 0, "unfinished": 0, "error": 0}
    with args.out.open("a") as fh:
        for persona in personas:
            for _ in range(args.samples_per_persona):
                if attempted >= args.n:
                    break
                attempted += 1
                try:
                    traj = rollout(env, teacher, persona["id"], args.max_turns)
                except (httpx.HTTPError, KeyError, ValueError):
                    rejects["error"] += 1
                    continue
                if keep(traj, args.min_reward):
                    kept += 1
                    fh.write(json.dumps({"id": persona["id"], **traj}, ensure_ascii=False) + "\n")
                elif not traj["done"]:
                    rejects["unfinished"] += 1
                elif traj["boundary_flags"]:
                    rejects["boundary"] += 1
                elif not traj["citations_valid"]:
                    rejects["citations"] += 1
                else:
                    rejects["reward"] += 1
    write_result(
        f"rollout-{args.teacher}",
        {
            "stage": "teacher_rollout",
            "config": {k: str(v) for k, v in vars(args).items()},
            "data_hash": file_hash(args.personas),
            "metrics": {"attempted": attempted, "kept": kept, "rejected": rejects},
        },
    )
    print(f"kept {kept}/{attempted} -> {args.out}")


if __name__ == "__main__":
    main()
