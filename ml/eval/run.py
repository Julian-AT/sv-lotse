"""T1 runner (§8): a policy behind an OpenAI-compatible endpoint plays the AT-Benefits gym.

Modes: ``no-engine`` (ReAct without engine tools; only ``submit_plan``) and ``engine`` (the real
brain tools through the research tool server). Gold always comes from the server's ``POST /gold``.

    uv run python -m eval.run --base-url https://api.openai.com/v1 --model <model> \
        --api-key-env OPENAI_API_KEY --mode both --personas data/personas --split test --n 200 \
        --trials 8

Writes ``results/t1-<model>-<mode>-<gitsha>.json`` with config, data hash, per-episode records and
the §5.6 metrics per split, language and area.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx

from gym import slots as S
from gym.data import load_personas
from gym.env import AtBenefitsEnv
from gym.metrics import aggregate
from gym.paths import DEFAULT_SERVER, RESULTS_DIR, from_wire_name, git_sha
from gym.simulator import LLMSimulator, RuleSimulator, Simulator
from gym.tools import SUBMIT_PLAN, SUBMIT_PLAN_SCHEMA, function_defs
from gym.transport import HttpTransport

MAX_API_CALLS = 40


class ChatPolicy:
    def __init__(self, base_url: str, model: str, api_key: str, temperature: float, tools: list):
        self.model = model
        self.temperature = temperature
        self.tools = tools
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=180.0,
            headers={"Authorization": f"Bearer {api_key}"},
        )

    def __call__(self, messages: list[dict[str, Any]]) -> tuple[dict[str, Any], int]:
        body = {
            "model": self.model,
            "messages": messages,
            "tools": self.tools,
            "temperature": self.temperature,
        }
        for attempt in range(4):
            response = self._client.post("/chat/completions", json=body)
            if response.status_code in (429, 500, 502, 503) and attempt < 3:
                time.sleep(2**attempt)
                continue
            response.raise_for_status()
            data = response.json()
            usage = data.get("usage") or {}
            return data["choices"][0]["message"], int(usage.get("total_tokens") or 0)
        raise RuntimeError("unreachable")


def to_actions(message: dict[str, Any]) -> list[dict[str, Any]]:
    """Translate one assistant message into gym actions."""
    actions: list[dict[str, Any]] = []
    for call in message.get("tool_calls") or []:
        fn = call.get("function") or {}
        wire = fn.get("name", "")
        try:
            args = json.loads(fn.get("arguments") or "{}")
        except json.JSONDecodeError:
            args = None
        if wire == SUBMIT_PLAN:
            return [{"type": "final", "plan": args if isinstance(args, dict) else {}}]
        name = from_wire_name(wire) or wire
        actions.append({"type": "tool", "name": name, "input": args})
    if not actions:
        actions.append({"type": "message", "content": message.get("content") or ""})
    return actions


def persona_area(persona: dict[str, Any]) -> Any:
    return persona.get("area") or (persona.get("gold") or {}).get("areas")


def run_episode(
    env: AtBenefitsEnv, policy: ChatPolicy, persona: dict[str, Any], trial: int
) -> dict[str, Any]:
    obs = env.reset(persona)
    started = time.time()
    tokens = 0
    done = False
    info: dict[str, Any] = {}
    for _ in range(MAX_API_CALLS):
        message, used = policy(obs["messages"])
        tokens += used
        for action in to_actions(message):
            obs, _, done, info = env.step(action)
            if done:
                break
        if done:
            break
    if not done:
        obs, _, done, info = env.step({"type": "final", "plan": None})
    breakdown = info.get("breakdown") or {}
    return {
        "persona_id": persona.get("id"),
        "trial": trial,
        "split": persona.get("split"),
        "language": S.language(persona),
        "area": persona_area(persona),
        "tokens": tokens,
        "latency_s": round(time.time() - started, 3),
        **breakdown,
    }


def make_simulator(kind: str) -> Simulator:
    return LLMSimulator() if kind == "llm" else RuleSimulator(noise=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="T1 runner for an OpenAI-compatible policy")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--mode", choices=["no-engine", "engine", "both"], default="both")
    parser.add_argument("--personas", required=True)
    parser.add_argument("--split", default="test")
    parser.add_argument("--n", type=int, default=200)
    parser.add_argument("--trials", type=int, default=1)
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--simulator", choices=["rule", "llm"], default="rule")
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args(argv)

    api_key = os.environ.get(args.api_key_env, "EMPTY")
    probe = HttpTransport(args.server)
    if not probe.health():
        print(f"tool server not reachable at {args.server}", file=sys.stderr)
        return 1
    personas = load_personas(args.personas, args.split, args.n)
    if not personas:
        print("no personas", file=sys.stderr)
        return 1
    data_hash = hashlib.sha256("\n".join(str(p.get("id")) for p in personas).encode()).hexdigest()
    modes = ["no-engine", "engine"] if args.mode == "both" else [args.mode]
    server_schemas = probe.tool_schemas()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_model = re.sub(r"[^A-Za-z0-9._-]+", "_", args.model)

    for mode in modes:
        tools = function_defs(server_schemas) if mode == "engine" else [SUBMIT_PLAN_SCHEMA]

        def one(job: tuple[dict[str, Any], int], tools: list = tools) -> dict[str, Any]:
            persona, trial = job
            env = AtBenefitsEnv(HttpTransport(args.server), make_simulator(args.simulator))
            policy = ChatPolicy(args.base_url, args.model, api_key, args.temperature, tools)
            try:
                return run_episode(env, policy, persona, trial)
            except Exception as exc:  # noqa: BLE001 - record and continue
                return {"persona_id": persona.get("id"), "trial": trial, "error": repr(exc)}

        jobs = [(p, t) for p in personas for t in range(args.trials)]
        with ThreadPoolExecutor(args.workers) as pool:
            records = list(pool.map(one, jobs))
        scored = [r for r in records if "error" not in r]
        result = {
            "table": "T1",
            "system": f"{args.model} ({mode})",
            "config": {**vars(args), "mode": mode},
            "git_sha": git_sha(),
            "data_hash": data_hash,
            "errors": [r for r in records if "error" in r],
            "metrics": aggregate(scored, k_max=min(8, args.trials)) if scored else None,
            "episodes": records,
        }
        out = RESULTS_DIR / f"t1-{safe_model}-{mode}-{git_sha()}.json"
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {out} ({len(scored)} scored, {len(result['errors'])} errors)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
