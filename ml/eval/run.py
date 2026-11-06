"""T1 runner (§8): a policy behind an OpenAI-compatible endpoint plays the AT-Benefits gym.

Modes (conditions): ``engine`` (the real brain tools through the research tool server, only the
tools the server marks available, plus ``submit_plan``) and ``no-engine`` (closed book: only
``submit_plan``; the system prompt lists the catalog's benefit, office and document ids so the
plan can be scored, but no criteria, mappings or source URLs). Gold always comes from the
server's ``POST /gold``.

    uv run python -m eval.run --base-url https://api.openai.com/v1 --model <model> \
        --env-file ../.env.local --api responses --reasoning-effort low --mode both \
        --personas data/personas --split test,heldout_family --n 100,50 --sample stratified \
        --max-usd 15

Writes ``results/t1-<mode>-<model>-<gitsha>.json`` with config, persona ids and data hash,
per-episode records, token usage and a list-price cost estimate, and the §5.6 metrics per split,
language and life situation.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import re
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import httpx

from gym import slots as S
from gym.data import load_personas
from gym.env import SYSTEM_PROMPT, AtBenefitsEnv
from gym.metrics import aggregate
from gym.paths import DEFAULT_SERVER, REPO_DIR, RESULTS_DIR, from_wire_name, git_sha
from gym.simulator import LLMSimulator, RuleSimulator, Simulator
from gym.tools import FALLBACK_SCHEMAS, SUBMIT_PLAN, SUBMIT_PLAN_SCHEMA, function_defs
from gym.transport import HttpTransport

MAX_API_CALLS = 40
PROMPTS_VERSION = "t1.v2"
GROUP_BY = ("split", "language", "life_situation")

NO_ENGINE_PROMPT = (
    "Du bist SV KI-Lotse, ein Assistent für österreichische Sozialversicherungs-Leistungen. "
    "Du hast KEINE Werkzeuge außer submit_plan: antworte aus deinem eigenen Wissen. "
    "Kläre die Situation mit wenigen, gezielten Fragen und reiche am Ende mit submit_plan einen "
    "Plan ein. Verwende ausschließlich die IDs aus den Listen unten (benefits, "
    "office_per_benefit, documents_per_benefit, next_step.benefitId); citations sind URLs "
    "offizieller Quellen. Keine medizinischen Einschätzungen: keine Diagnosen, Dosierungen, "
    "Befundinterpretationen oder Risikobewertungen."
)


def usage_of(data: dict[str, Any]) -> dict[str, int]:
    u = data.get("usage") or {}
    return {
        "prompt_tokens": int(u.get("prompt_tokens") or 0),
        "completion_tokens": int(u.get("completion_tokens") or 0),
        "cached_tokens": int((u.get("prompt_tokens_details") or {}).get("cached_tokens") or 0),
        "total_tokens": int(u.get("total_tokens") or 0),
    }


def to_responses_input(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Chat-format gym history -> Responses API input items (stateless, no stored ids)."""
    items: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        if role == "tool":
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": m.get("tool_call_id"),
                    "output": m.get("content") or "",
                }
            )
            continue
        if m.get("content"):
            items.append({"role": role, "content": m["content"]})
        for call in m.get("tool_calls") or []:
            fn = call.get("function") or {}
            items.append(
                {
                    "type": "function_call",
                    "call_id": call.get("id"),
                    "name": fn.get("name"),
                    "arguments": fn.get("arguments") or "{}",
                }
            )
    return items


def to_responses_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": t["function"]["name"],
            "description": t["function"].get("description") or "",
            "parameters": t["function"].get("parameters") or {"type": "object"},
            "strict": False,
        }
        for t in tools
    ]


def from_responses_output(data: dict[str, Any]) -> tuple[dict[str, Any], dict[str, int]]:
    """Responses API result -> (chat-format assistant message, usage)."""
    texts: list[str] = []
    calls: list[dict[str, Any]] = []
    for item in data.get("output") or []:
        if item.get("type") == "message":
            for part in item.get("content") or []:
                if part.get("type") == "output_text":
                    texts.append(part.get("text") or "")
        elif item.get("type") == "function_call":
            calls.append(
                {
                    "id": item.get("call_id"),
                    "type": "function",
                    "function": {"name": item.get("name"), "arguments": item.get("arguments")},
                }
            )
    message: dict[str, Any] = {"role": "assistant", "content": "\n".join(texts) or None}
    if calls:
        message["tool_calls"] = calls
    u = data.get("usage") or {}
    usage = {
        "prompt_tokens": int(u.get("input_tokens") or 0),
        "completion_tokens": int(u.get("output_tokens") or 0),
        "cached_tokens": int((u.get("input_tokens_details") or {}).get("cached_tokens") or 0),
        "total_tokens": int(u.get("total_tokens") or 0),
    }
    return message, usage


def price_usd(model: str, usage: dict[str, int]) -> float:
    """List-price USD estimate (datagen/pricing.py); 0.0 for an unpriced model."""
    from datagen.pricing import cost

    return cost(
        model,
        usage.get("prompt_tokens", 0),
        usage.get("completion_tokens", 0),
        usage.get("cached_tokens", 0),
    )


class ChatPolicy:
    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str,
        temperature: float | None,
        tools: list,
        reasoning_effort: str | None = None,
        api: str = "chat",
    ):
        self.model = model
        self.temperature = temperature
        self.tools = tools
        self.reasoning_effort = reasoning_effort
        self.api = api
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            timeout=180.0,
            headers={"Authorization": f"Bearer {api_key}"},
        )

    def body(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        if self.api == "responses":
            body: dict[str, Any] = {
                "model": self.model,
                "input": to_responses_input(messages),
                "tools": to_responses_tools(self.tools),
                "store": False,
            }
            if self.reasoning_effort:
                body["reasoning"] = {"effort": self.reasoning_effort}
            elif self.temperature is not None:
                body["temperature"] = self.temperature
            return body
        body = {"model": self.model, "messages": messages, "tools": self.tools}
        if self.reasoning_effort:
            body["reasoning_effort"] = self.reasoning_effort  # reasoning models: no temperature
        elif self.temperature is not None:
            body["temperature"] = self.temperature
        return body

    def __call__(self, messages: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, int]]:
        body = self.body(messages)
        path = "/responses" if self.api == "responses" else "/chat/completions"
        for attempt in range(5):
            try:
                response = self._client.post(path, json=body)
            except httpx.TransportError:
                if attempt < 4:
                    time.sleep(2**attempt)
                    continue
                raise
            if response.status_code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** (attempt + 1))
                continue
            if response.status_code >= 400:
                raise RuntimeError(f"policy HTTP {response.status_code}: {response.text[:400]}")
            data = response.json()
            if self.api == "responses":
                return from_responses_output(data)
            return data["choices"][0]["message"], usage_of(data)
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
    env: AtBenefitsEnv, policy: Any, persona: dict[str, Any], trial: int, model: str = ""
) -> dict[str, Any]:
    obs = env.reset(persona)
    started = time.time()
    usage: dict[str, int] = defaultdict(int)
    done = False
    info: dict[str, Any] = {}
    tool_errors = 0
    api_calls = 0
    plan_submitted = False
    for _ in range(MAX_API_CALLS):
        message, used = policy(obs["messages"])
        api_calls += 1
        if isinstance(used, dict):
            for key, value in used.items():
                usage[key] += int(value)
        else:
            usage["total_tokens"] += int(used)
        for action in to_actions(message):
            plan_submitted = plan_submitted or action["type"] == "final"
            obs, _, done, info = env.step(action)
            if action["type"] == "tool" and info.get("ok") is False:
                tool_errors += 1
            if done:
                break
        if done:
            break
    truncated = bool(info.get("truncated")) or not done
    if not done:
        obs, _, done, info = env.step({"type": "final", "plan": None})
    breakdown = info.get("breakdown") or {}
    state = env.state
    return {
        "persona_id": persona.get("id"),
        "trial": trial,
        "split": persona.get("split"),
        "language": S.language(persona),
        "area": persona_area(persona),
        "life_situation": persona.get("life_situation"),
        "scenario": persona.get("scenario"),
        "tokens": usage["total_tokens"],
        "prompt_tokens": usage["prompt_tokens"],
        "completion_tokens": usage["completion_tokens"],
        "cached_tokens": usage["cached_tokens"],
        "cost_usd": round(price_usd(model, usage), 6) if model else 0.0,
        "api_calls": api_calls,
        "turns": state.turn if state else None,
        "tool_calls": state.tool_calls if state else None,
        "tool_errors": tool_errors,
        "plan_submitted": plan_submitted,
        "truncated": truncated,
        "latency_s": round(time.time() - started, 3),
        "plan": state.plan if state else None,
        **breakdown,
    }


def make_simulator(kind: str) -> Simulator:
    return LLMSimulator() if kind == "llm" else RuleSimulator(noise=True)


def sample_personas(
    personas: list[dict[str, Any]], n: int, seed: int, how: str = "stratified"
) -> list[dict[str, Any]]:
    """``first`` n, or a seeded sample stratified by scenario (largest-remainder allocation)."""
    if how == "first" or n >= len(personas):
        return personas[:n]
    rng = random.Random(seed)
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for persona in personas:
        groups[str(persona.get("scenario") or persona.get("goal"))].append(persona)
    quota = {k: n * len(v) / len(personas) for k, v in groups.items()}
    take = {k: int(q) for k, q in quota.items()}
    for k in sorted(quota, key=lambda k: (-(quota[k] - take[k]), k))[: n - sum(take.values())]:
        take[k] += 1
    out: list[dict[str, Any]] = []
    for key in sorted(groups):
        out += rng.sample(groups[key], take[key])
    rng.shuffle(out)
    return out


def _ids(path: Path) -> list[tuple[str, str]]:
    import yaml

    if path.suffix in (".yaml", ".yml"):
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    else:
        data = json.loads(path.read_text(encoding="utf-8"))
    items = data if isinstance(data, list) else [data]
    return [
        (str(i["id"]), str(i.get("name_de") or i.get("name") or ""))
        for i in items
        if isinstance(i, dict) and i.get("id")
    ]


def office_ids() -> list[str]:
    root = REPO_DIR / "packages" / "knowledge" / "offices"
    ids = {i for p in root.rglob("*") if p.suffix in (".yaml", ".yml", ".json") for i, _ in _ids(p)}
    return sorted(ids - {"example-office"})


def no_engine_prompt(summary: dict[str, Any], offices: list[str]) -> str:
    """Closed-book prompt: the answer space (ids and names) without engine knowledge."""
    benefits = [f"{b['id']}: {b.get('name_de', '')}" for b in summary.get("benefits", [])]
    docs = [
        f"{d['id']}: {d.get('name_de', '')}"
        for d in (summary.get("vocabulary") or {}).get("documents", [])
    ]
    return (
        f"{NO_ENGINE_PROMPT}\n\nLeistungs-IDs:\n"
        + "\n".join(benefits)
        + "\n\nStellen-IDs (office_per_benefit):\n"
        + ", ".join(offices)
        + "\n\nDokument-IDs (documents_per_benefit):\n"
        + "\n".join(docs)
    )


def engine_prompt(summary: dict[str, Any]) -> str:
    """The gym system prompt plus the plan's id contract and office.resolve value lists (the
    same answer space the no-engine condition gets, without engine knowledge)."""
    v = summary.get("vocabulary") or {}
    return (
        f"{SYSTEM_PROMPT}\n\nIm Plan nur IDs verwenden: benefits = Leistungs-id aus "
        "catalog.findBenefits, office_per_benefit = Stellen-id aus office.resolve, "
        "documents_per_benefit = Dokument-type aus documents.checklist, next_step.benefitId = "
        "Leistungs-id, citations = Quell-URLs aus den Werkzeug-Ausgaben.\n"
        f"Werte für office.resolve: carrier aus {', '.join(v.get('carriers') or [])}; "
        f"subjectStatus aus {', '.join(v.get('statuses') or [])} (pensioner:<"
        f"{'|'.join(v.get('pension_carriers') or [])}> wenn bekannt); region aus "
        f"{', '.join(v.get('regions') or [])}."
    )


def engine_tools(server_schemas: Any) -> list[dict[str, Any]]:
    """The gym's engine tools that the research server can run (model tools return 501)."""
    entries: list[tuple[Any, Any]] = []
    if isinstance(server_schemas, list):
        entries = [(s.get("name"), s) for s in server_schemas if isinstance(s, dict)]
    elif isinstance(server_schemas, dict):
        entries = list(server_schemas.items())
    unavailable = {k for k, v in entries if isinstance(v, dict) and v.get("available") is False}
    names = [n for n in FALLBACK_SCHEMAS if n not in unavailable]
    return function_defs(server_schemas, names)


def load_env_file(path: str | None) -> None:
    """Load KEY=VALUE pairs into this process only (never printed)."""
    if not path:
        return
    from dotenv import load_dotenv

    load_dotenv(path, override=False)


def _split_args(args: argparse.Namespace) -> list[tuple[str, int]]:
    splits = [s.strip() for s in str(args.split).split(",") if s.strip()]
    counts = [int(c) for c in str(args.n).split(",") if c.strip()]
    if len(counts) == 1:
        counts *= len(splits)
    if len(counts) != len(splits):
        raise SystemExit("--n needs one count or one per --split")
    return list(zip(splits, counts, strict=True))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="T1 runner for an OpenAI-compatible policy")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--env-file", default=None, help="dotenv file loaded in-process")
    parser.add_argument("--mode", choices=["no-engine", "engine", "both"], default="both")
    parser.add_argument("--personas", required=True)
    parser.add_argument("--split", default="test", help="one split or a comma list")
    parser.add_argument("--n", default="200", help="count, or one count per split")
    parser.add_argument("--sample", choices=["first", "stratified"], default="first")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--trials", type=int, default=1)
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--simulator", choices=["rule", "llm"], default="rule")
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--reasoning-effort", default=None, help="e.g. low; drops temperature")
    parser.add_argument("--api", choices=["chat", "responses"], default="chat")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--max-usd", type=float, default=None, help="stop starting episodes")
    parser.add_argument("--tag", default="", help="suffix for the result file name")
    args = parser.parse_args(argv)

    load_env_file(args.env_file)
    api_key = os.environ.get(args.api_key_env, "EMPTY")
    probe = HttpTransport(args.server)
    if not probe.health():
        print(f"tool server not reachable at {args.server}", file=sys.stderr)
        return 1
    personas: list[dict[str, Any]] = []
    for split, n in _split_args(args):
        pool = load_personas(args.personas, split, None if args.sample == "stratified" else n)
        personas += sample_personas(pool, n, args.seed, args.sample)
    if not personas:
        print("no personas", file=sys.stderr)
        return 1
    persona_ids = [str(p.get("id")) for p in personas]
    data_hash = hashlib.sha256("\n".join(persona_ids).encode()).hexdigest()
    modes = ["no-engine", "engine"] if args.mode == "both" else [args.mode]
    server_schemas = probe.tool_schemas()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    safe_model = re.sub(r"[^A-Za-z0-9._-]+", "_", args.model)
    spent = {"usd": 0.0}
    lock = threading.Lock()

    for mode in modes:
        if mode == "engine":
            tools = engine_tools(server_schemas)
            system_prompt = engine_prompt(probe.catalog_summary())
        else:
            tools = [SUBMIT_PLAN_SCHEMA]
            system_prompt = no_engine_prompt(probe.catalog_summary(), office_ids())
        progress = {"n": 0, "usd": 0.0}
        total_jobs = len(personas) * args.trials

        def one(
            job: tuple[dict[str, Any], int],
            tools: list = tools,
            system_prompt: str = system_prompt,
            mode: str = mode,
            progress: dict = progress,
            total_jobs: int = total_jobs,
        ) -> dict[str, Any]:
            persona, trial = job
            if args.max_usd is not None and spent["usd"] >= args.max_usd:
                return {"persona_id": persona.get("id"), "trial": trial, "skipped": "budget"}
            env = AtBenefitsEnv(
                HttpTransport(args.server),
                make_simulator(args.simulator),
                system_prompt=system_prompt,
                tools=tools,
            )
            policy = ChatPolicy(
                args.base_url,
                args.model,
                api_key,
                args.temperature,
                tools,
                args.reasoning_effort,
                args.api,
            )
            try:
                record = run_episode(env, policy, persona, trial, args.model)
            except Exception as exc:  # noqa: BLE001 - record and continue
                record = {"persona_id": persona.get("id"), "trial": trial, "error": repr(exc)[:500]}
            with lock:
                spent["usd"] += float(record.get("cost_usd") or 0.0)
                progress["usd"] += float(record.get("cost_usd") or 0.0)
                progress["n"] += 1
                if progress["n"] % 10 == 0 or progress["n"] == total_jobs:
                    print(
                        f"[{mode}] {progress['n']}/{total_jobs} episodes, "
                        f"${progress['usd']:.2f} this mode, ${spent['usd']:.2f} total",
                        flush=True,
                    )
            return record

        jobs = [(p, t) for p in personas for t in range(args.trials)]
        started = time.time()
        with ThreadPoolExecutor(args.workers) as pool:
            records = list(pool.map(one, jobs))
        wall = time.time() - started
        scored = [r for r in records if "error" not in r and "skipped" not in r]
        usage = {
            key: int(sum(int(r.get(key) or 0) for r in scored))
            for key in ("prompt_tokens", "completion_tokens", "cached_tokens", "tokens")
        }
        sha = git_sha()
        result = {
            "table": "T1",
            "system": f"{args.model} ({mode})",
            "condition": mode,
            "config": {
                **{k: v for k, v in vars(args).items() if k != "env_file"},
                "mode": mode,
                "policy_model": args.model,
                "simulator": "RuleSimulator(noise=True, seed=0)"
                if args.simulator == "rule"
                else f"LLMSimulator({os.environ.get('LOTSE_SIM_MODEL', '')})",
                "prompts_version": PROMPTS_VERSION,
                "system_prompt_sha256": hashlib.sha256(system_prompt.encode()).hexdigest(),
                "tools": [t["function"]["name"] for t in tools],
                "max_api_calls": MAX_API_CALLS,
                "splits": dict(_split_args(args)),
            },
            "git_sha": sha,
            "data_hash": data_hash,
            "persona_ids": persona_ids,
            "wall_clock_s": round(wall, 1),
            "usage": usage,
            "cost_usd_estimate": round(sum(float(r.get("cost_usd") or 0) for r in scored), 4),
            "cost_note": "list price from ml/datagen/pricing.py (Standard tier), not an invoice",
            "errors": [r for r in records if "error" in r],
            "skipped": [r for r in records if "skipped" in r],
            "metrics": aggregate(scored, GROUP_BY, k_max=min(8, args.trials)) if scored else None,
            "episodes": records,
        }
        suffix = f"-{args.tag}" if args.tag else ""
        out = RESULTS_DIR / f"t1-{mode}-{safe_model}{suffix}-{sha}.json"
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(
            f"wrote {out} ({len(scored)} scored, {len(result['errors'])} errors, "
            f"{len(result['skipped'])} skipped, ${result['cost_usd_estimate']:.2f}, {wall:.0f}s)"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
