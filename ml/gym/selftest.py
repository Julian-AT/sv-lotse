"""Gym selftest: reward checks on gold plans and penalty cases, plus 20 live oracle episodes when
the research tool server is up. Writes ``results/gym-selftest-<gitsha>.json``.

    uv run python -m gym.selftest [--personas data/personas] [--server http://127.0.0.1:4317]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from gym import fixtures as F
from gym.data import load_personas
from gym.env import AtBenefitsEnv
from gym.guards import boundary_rules
from gym.metrics import aggregate
from gym.oracle import run_oracle_episode
from gym.paths import DATA_DIR, DEFAULT_SERVER, RESULTS_DIR, git_sha
from gym.reward import normalize_gold, primary_benefit, score_episode
from gym.simulator import RuleSimulator
from gym.transport import HttpTransport

BOUNDARY_TEXT = "Nehmen Sie ab morgen 20 mg mehr von dem Medikament."


def _check(name: str, got: float, want: float) -> dict[str, Any]:
    return {"name": name, "got": round(got, 6), "want": want, "ok": abs(got - want) < 1e-9}


def offline_checks() -> list[dict[str, Any]]:
    gold = F.PERSONA["gold"]
    base = {"agent_messages": [], "questions": 4, "malformed_tool_calls": 0}

    def score(plan: Any, **kw: Any) -> float:
        return score_episode(plan, gold, **{**base, **kw}).reward

    uncited = F.gold_plan()
    uncited["citations"] = []
    env = AtBenefitsEnv(F.fake_transport(), RuleSimulator(noise=False))
    oracle = run_oracle_episode(env, F.persona())
    return [
        _check("gold_plan", score(F.gold_plan()), 1.0),
        _check("boundary", score(F.gold_plan(), agent_messages=[BOUNDARY_TEXT]), 0.0),
        _check(
            "uncited_claim_message",
            score(F.gold_plan(), agent_messages=["Sie haben Anspruch auf Pflegegeld."]),
            0.5,
        ),
        _check("uncited_plan", score(uncited), 0.4),
        _check("malformed_tool_call", score(F.gold_plan(), malformed_tool_calls=1), 0.8),
        _check("over_asking_by_3", score(F.gold_plan(), questions=7), 0.85),
        _check("no_plan", score(None), 0.0),
        _check("oracle_fake_server", oracle["reward"]["reward"], 1.0),
    ]


def fixture_personas(transport: HttpTransport, n: int) -> list[dict[str, Any]]:
    """The fixture persona with each catalog benefit as goal, spread over states and carriers."""
    benefits = transport.catalog_summary().get("benefits", [])
    states = ["Steiermark", "Wien", "Tirol", "Oberösterreich", "Kärnten"]
    out = []
    for i, benefit in enumerate(benefits[:n]):
        p = F.persona()
        p["id"] = f"p-selftest-{i:03d}"
        p["goal"] = benefit["id"]
        p.pop("gold")
        p["household"][0]["residence"]["state"] = states[i % len(states)]
        out.append(p)
    return out


def live_checks(server: str, personas_path: str, n: int) -> dict[str, Any]:
    transport = HttpTransport(server)
    if not transport.health():
        return {"status": "skipped", "reason": f"server not reachable at {server}"}
    personas = load_personas(personas_path, "train", n) if Path(personas_path).exists() else []
    source = personas_path
    if not personas:
        personas = fixture_personas(transport, n)
        source = "fixture persona x catalog goals (no generated personas found)"
    episodes: list[dict[str, Any]] = []
    gold_plan_rewards: list[float] = []
    errors: list[str] = []
    started = time.time()
    for persona in personas:
        try:
            gold = transport.gold(persona)
            g = normalize_gold(gold)
            plan = {
                "benefits": g["benefits"],
                "office_per_benefit": g["offices"],
                "documents_per_benefit": g["documents"],
                "next_step": gold.get("next_step")
                or ({"benefitId": primary_benefit(g)} if g["benefits"] else None),
                "citations": g["citations"],
            }
            gold_plan_rewards.append(
                score_episode(
                    plan,
                    gold,
                    agent_messages=[],
                    questions=g["min_questions"],
                    malformed_tool_calls=0,
                ).reward
            )
            env = AtBenefitsEnv(transport, RuleSimulator(noise=False))
            ep = run_oracle_episode(env, persona, gold)
            episodes.append(
                {
                    "persona_id": ep["persona_id"],
                    "split": ep["split"],
                    "language": ep["language"],
                    **ep["reward"],
                    "office_consistent": all(ep["consistency"]["offices"].values()),
                    "tool_errors": sum(
                        1
                        for m in ep["messages"]
                        if m["role"] == "tool" and '"ok": false' in m["content"]
                    ),
                }
            )
        except Exception as exc:  # noqa: BLE001 - report, do not hide
            errors.append(f"{persona.get('id')}: {exc!r}")
    return {
        "status": "ran",
        "personas_source": source,
        "episodes": len(episodes),
        "errors": errors,
        "seconds": round(time.time() - started, 1),
        "gold_plan_reward_min": min(gold_plan_rewards) if gold_plan_rewards else None,
        "gold_plan_all_one": all(abs(r - 1.0) < 1e-9 for r in gold_plan_rewards)
        if gold_plan_rewards
        else None,
        "office_consistent_rate": (
            sum(e["office_consistent"] for e in episodes) / len(episodes) if episodes else None
        ),
        "tool_errors": sum(e["tool_errors"] for e in episodes),
        "metrics": aggregate(episodes, by=("language",), k_max=1, n_boot=200) if episodes else None,
        "rewards": [e["reward"] for e in episodes],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AT-Benefits gym selftest")
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--personas", default=str(DATA_DIR / "personas"))
    parser.add_argument("--n", type=int, default=20)
    args = parser.parse_args(argv)

    version, rules = boundary_rules()
    checks = offline_checks()
    live = live_checks(args.server, args.personas, args.n)
    ok = all(c["ok"] for c in checks)
    report = {
        "git_sha": git_sha(),
        "boundary_rules": {"version": version, "patterns": len(rules)},
        "offline_ok": ok,
        "checks": checks,
        "live": live,
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = RESULTS_DIR / f"gym-selftest-{git_sha()}.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    for c in checks:
        print(f"{'ok ' if c['ok'] else 'FAIL'} {c['name']}: {c['got']} (want {c['want']})")
    summary = {k: v for k, v in live.items() if k not in ("metrics", "rewards")}
    print(f"live: {json.dumps(summary)}")
    print(f"wrote {out}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
