"""Oracle policy: uses gold plus the real tools to produce correct, cited trajectories.

It asks exactly the missing office-context slots (those not stated in the situation text, or the
gold ``missing_slots`` when the server provides them), calls ``catalog.findBenefits``,
``office.resolve`` and ``documents.checklist`` per gold benefit, summarises with sources and submits
the gold plan. Trajectories are kept when R ≥ ``--min-reward`` with no boundary flag and valid
citations (rejection sampling, §7.1).

    uv run python -m gym.oracle --personas data/personas --split train --n 5000 \
        --out data/sft/oracle.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from gym import slots as S
from gym import world as W
from gym.data import load_personas
from gym.env import AtBenefitsEnv
from gym.paths import DEFAULT_SERVER, git_sha
from gym.reward import collect_urls, normalize_gold, primary_benefit
from gym.simulator import RuleSimulator
from gym.tools import function_defs
from gym.transport import HttpTransport, Transport

SUMMARY = {
    "de": (
        "Danke. Nach den Regeln im Katalog kommen diese Leistungen in Frage: {items}. "
        "Ich schicke Ihnen den Plan mit den Quellen."
    ),
    "en": (
        "Thank you. According to the catalog rules these benefits may apply: {items}. "
        "I am sending you the plan with the sources."
    ),
    "tr": (
        "Teşekkürler. Katalog kurallarına göre şu yardımlar söz konusu olabilir: {items}. "
        "Planı kaynaklarıyla birlikte gönderiyorum."
    ),
}


def questions_to_ask(
    persona: dict[str, Any], gold: dict[str, Any], known: set[str]
) -> list[tuple[str, str]]:
    """(slot, question) pairs: the engine's ``question_slots`` from gold when present, otherwise the
    office-context slots not stated in the opening."""
    lang = S.language(persona)
    engine = gold.get("question_slots", gold.get("missing_slots"))
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    if engine is not None:
        for slot_id in engine:
            slot = S.map_engine_slot(str(slot_id))
            if slot in seen:
                continue
            seen.add(slot)
            if slot in S.SLOT_PATHS:
                out.append((slot, S.question_for(slot, lang)))
            elif hint := W.hint_for(gold.get("process"), str(slot_id)):
                out.append((slot, hint))
        return out
    wanted = list(S.OFFICE_CONTEXT_SLOTS)
    if S.slot_value(persona, "insurance_status") == "pensioner" and gold.get("offices"):
        wanted.append("pension_carrier")
    for slot in wanted:
        if slot in known or slot in seen or S.slot_value(persona, slot) in (None, []):
            continue
        seen.add(slot)
        out.append((slot, S.question_for(slot, lang)))
    return out


def office_inputs(persona: dict[str, Any], gold: dict[str, Any]) -> dict[str, str]:
    facts = gold.get("facts") or {}
    carrier = facts.get("carrier") or W.carrier_value(
        str(S.slot_value(persona, "insurance_carrier") or "")
    )
    region = facts.get("region") or str(S.slot_value(persona, "residence_state") or "")
    status = W.office_status(
        S.slot_value(persona, "insurance_status"), S.slot_value(persona, "pension_carrier")
    )
    return {"carrier": str(carrier), "subjectStatus": status, "region": str(region)}


def run_oracle_episode(
    env: AtBenefitsEnv, persona: dict[str, Any], gold: dict[str, Any] | None = None
) -> dict[str, Any]:
    env.reset(persona, gold=gold)
    state = env.state
    assert state is not None
    gold_raw = state.gold
    g = normalize_gold(gold_raw)
    lang = S.language(persona)
    situation = str(persona.get("situation_text") or "")

    for _, question in questions_to_ask(persona, gold_raw, set(state.known)):
        env.step({"type": "message", "content": question})

    office = office_inputs(persona, gold_raw)
    facts = gold_raw.get("facts") or {}
    age = S.slot_value(persona, "age")
    subject = {
        "ageBand": str(age) if isinstance(age, int) else None,
        "carrier": office["carrier"] or None,
        "region": office["region"] or None,
        "status": str(facts.get("status") or "") or None,
    }
    find_input: dict[str, Any] = {
        "goalText": situation,
        "subject": {k: v for k, v in subject.items() if v},
    }
    if gold_raw.get("life_situation"):
        find_input["lifeSituation"] = gold_raw["life_situation"]
    consistency: dict[str, Any] = {"offices": {}, "found": []}

    _, _, _, info = env.step(
        {
            "type": "tool",
            "name": "catalog.findBenefits",
            "input": find_input,
        }
    )
    found = info["result"].output if info.get("ok") else None
    if isinstance(found, list):
        consistency["found"] = [b.get("id") for b in found if isinstance(b, dict)]

    for benefit in g["benefits"]:
        if state.done:
            break
        if benefit in g["offices"]:
            _, _, _, info = env.step(
                {
                    "type": "tool",
                    "name": "office.resolve",
                    "input": {"benefitId": benefit, **office},
                }
            )
            out = info["result"].output if info.get("ok") else None
            consistency["offices"][benefit] = (
                isinstance(out, dict) and out.get("id") == g["offices"][benefit]
            )
        if benefit in g["documents"]:
            env.step(
                {
                    "type": "tool",
                    "name": "documents.checklist",
                    "input": {
                        "benefitId": benefit,
                        "subjectId": state.subject_id or str(persona.get("id", "subject")),
                    },
                }
            )

    citations = list(dict.fromkeys(g["citations"]))
    if not citations and isinstance(found, list):
        for item in found:
            if isinstance(item, dict) and item.get("id") in g["benefits"]:
                citations.extend(sorted(collect_urls(item.get("sources", []))))
    if g["benefits"] and not state.done:
        items = ", ".join(g["benefits"])
        summary = SUMMARY.get(lang, SUMMARY["de"]).format(items=items)
        if citations:
            summary += " " + " ".join(citations[:3])
        env.step({"type": "message", "content": summary})

    if state.done:  # truncated by the turn or tool-call cap
        return episode_record(persona, lang, env.state, consistency)
    next_step = gold_raw.get("next_step")
    if next_step is None and g["benefits"]:
        next_step = {"benefitId": primary_benefit(g)}
    plan = {
        "benefits": g["benefits"],
        "office_per_benefit": g["offices"],
        "documents_per_benefit": g["documents"],
        "next_step": next_step,
        "citations": citations,
    }
    env.step({"type": "final", "plan": plan})
    return episode_record(persona, lang, env.state, consistency)


def episode_record(
    persona: dict[str, Any], lang: str, state: Any, consistency: dict[str, Any]
) -> dict[str, Any]:
    return {
        "persona_id": persona.get("id"),
        "split": persona.get("split"),
        "language": lang,
        "messages": [dict(m) for m in state.messages],
        "reward": state.breakdown.as_dict(),
        "consistency": consistency,
    }


def accept(episode: dict[str, Any], min_reward: float) -> bool:
    r = episode["reward"]
    return r["reward"] >= min_reward and r["boundary"] == 0 and r["cite_valid"] == 1.0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--personas", required=True, help="directory or JSONL file")
    parser.add_argument("--split", default="train")
    parser.add_argument("--n", type=int, default=5000)
    parser.add_argument("--out", required=True)
    parser.add_argument("--server", default=DEFAULT_SERVER)
    parser.add_argument("--noise", action="store_true", help="noisy rule simulator answers")
    parser.add_argument("--min-reward", type=float, default=0.9)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument(
        "--use-persona-gold",
        action="store_true",
        help="use the persona's embedded gold instead of POST /gold",
    )
    args = parser.parse_args(argv)

    personas = load_personas(args.personas, args.split, args.n)
    if not personas:
        print(f"no personas for split {args.split} in {args.personas}", file=sys.stderr)
        return 1
    probe = HttpTransport(args.server)
    if not probe.health():
        print(f"tool server not reachable at {args.server}", file=sys.stderr)
        return 1
    tool_defs = function_defs(probe.tool_schemas())

    def one(persona: dict[str, Any]) -> dict[str, Any] | None:
        transport: Transport = HttpTransport(args.server)
        env = AtBenefitsEnv(transport, RuleSimulator(noise=args.noise))
        try:
            gold = persona["gold"] if args.use_persona_gold else None
            return run_oracle_episode(env, persona, gold)
        except Exception as exc:  # noqa: BLE001 - one bad persona must not stop the run
            return {"persona_id": persona.get("id"), "error": repr(exc)}

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    kept = rejected = errors = 0
    rewards: list[float] = []
    started = time.time()
    meta = {"git_sha": git_sha(), "server": args.server, "noise": args.noise}
    with out_path.open("w", encoding="utf-8") as handle, ThreadPoolExecutor(args.workers) as pool:
        for episode in pool.map(one, personas):
            if episode is None or "error" in episode:
                errors += 1
                if errors <= 5:
                    print(f"error: {episode}", file=sys.stderr)
                continue
            rewards.append(episode["reward"]["reward"])
            if not accept(episode, args.min_reward):
                rejected += 1
                continue
            kept += 1
            record = {
                "id": f"oracle-{episode['persona_id']}",
                **episode,
                "tools": tool_defs,
                "meta": meta,
            }
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    summary = {
        "personas": len(personas),
        "kept": kept,
        "rejected": rejected,
        "errors": errors,
        "mean_reward": (sum(rewards) / len(rewards)) if rewards else None,
        "seconds": round(time.time() - started, 1),
        "out": str(out_path),
        **meta,
    }
    print(json.dumps(summary))
    return 0 if kept else 2


if __name__ == "__main__":
    raise SystemExit(main())
