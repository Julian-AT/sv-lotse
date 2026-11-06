from __future__ import annotations

import pytest

from gym import fixtures as F
from gym import slots as S
from gym.env import AtBenefitsEnv
from gym.guards import boundary_rules, check_boundary
from gym.metrics import aggregate, pass_hat_k
from gym.oracle import run_oracle_episode
from gym.paths import tool_names
from gym.reward import score_episode
from gym.simulator import RuleSimulator, persona_card


def _score(plan, **kw):
    args = {"agent_messages": [], "questions": 4, "malformed_tool_calls": 0}
    args.update(kw)
    return score_episode(plan, F.PERSONA["gold"], **args)


def test_gold_plan_scores_one():
    r = _score(F.gold_plan())
    assert r.reward == pytest.approx(1.0)


def test_partial_plan_components():
    plan = F.gold_plan()
    plan["benefits"] = ["pflegegeld"]
    plan["office_per_benefit"] = {"pflegegeld": "wrong"}
    r = _score(plan)
    assert r.f1_benefits == pytest.approx(2 / 3)
    assert r.acc_office == 0.0
    expected = 0.45 * (2 / 3) + 0.0 + 0.15 + 0.10 + 0.10
    assert r.reward == pytest.approx(expected)


def test_boundary_penalty_uses_product_rules():
    version, rules = boundary_rules()
    assert version.startswith("medical-boundary")
    assert len(rules) >= 10
    msg = "Nehmen Sie ab morgen 20 mg mehr von dem Medikament."
    assert check_boundary(msg)
    r = _score(F.gold_plan(), agent_messages=[msg])
    assert r.boundary == 1
    assert r.reward == pytest.approx(0.0)


def test_clean_text_has_no_boundary_hit():
    assert not check_boundary("In welchem Bundesland wohnt die Person?")


def test_uncited_claims():
    plan = F.gold_plan()
    plan["citations"] = []
    r = _score(plan)
    assert r.uncited == 1
    assert r.reward == pytest.approx(1.0 - 0.10 - 0.5)
    r2 = _score(F.gold_plan(), agent_messages=["Sie haben Anspruch auf Pflegegeld."])
    assert r2.uncited == 1 and r2.reward == pytest.approx(0.5)
    r3 = _score(F.gold_plan(), agent_messages=[f"Sie haben Anspruch auf Pflegegeld ({F.SRC_PG})."])
    assert r3.uncited == 0


def test_malformed_and_overasking():
    assert _score(F.gold_plan(), malformed_tool_calls=2).reward == pytest.approx(0.8)
    assert _score(F.gold_plan(), questions=7).reward == pytest.approx(1.0 - 0.15)


def test_missing_plan_scores_zero_components():
    r = score_episode(
        None, F.PERSONA["gold"], agent_messages=[], questions=0, malformed_tool_calls=0
    )
    assert r.reward == pytest.approx(0.0)


def test_tool_names_come_from_contracts():
    names = tool_names()
    assert {"catalog.findBenefits", "office.resolve", "documents.checklist"} <= names


@pytest.mark.parametrize("lang", ["de", "en", "tr"])
def test_question_templates_detect_their_slot(lang):
    for slot in S.SLOT_PATHS:
        assert S.detect_slots(S.question_for(slot, lang))[0] == slot, (lang, slot)


def test_rule_simulator_answers_only_what_is_asked():
    sim = RuleSimulator(noise=False)
    p = F.persona()
    reply = sim.reply(p, [], "In welchem Bundesland wohnt die Person?")
    assert "Steiermark" in reply.text and "ÖGK" not in reply.text
    assert reply.answered_slots == ["residence_state"]
    assert "gold" not in persona_card(p)


def test_env_shaping_and_malformed_tool():
    env = AtBenefitsEnv(F.fake_transport(), RuleSimulator(noise=False))
    env.reset(F.persona())
    _, r1, _, _ = env.step({"type": "message", "content": S.question_for("residence_state", "de")})
    _, r2, _, _ = env.step({"type": "message", "content": S.question_for("residence_state", "de")})
    assert r1 == pytest.approx(0.02) and r2 == pytest.approx(-0.02)
    _, _, _, info = env.step({"type": "tool", "name": "no.suchTool", "input": {}})
    assert info["malformed"]
    _, reward, done, info = env.step({"type": "final", "plan": F.gold_plan()})
    assert done
    assert info["breakdown"]["malformed"] == 1
    assert reward == pytest.approx(1.0 - 0.2)


def test_env_truncates_after_max_turns():
    env = AtBenefitsEnv(F.fake_transport(), RuleSimulator(noise=False), max_turns=3)
    env.reset(F.persona())
    done = False
    for _ in range(3):
        _, _, done, info = env.step({"type": "message", "content": "Hallo."})
    assert done and info.get("truncated")


def test_oracle_episode_is_perfect_with_fake_server():
    env = AtBenefitsEnv(F.fake_transport(), RuleSimulator(noise=False))
    ep = run_oracle_episode(env, F.persona())
    assert ep["reward"]["reward"] == pytest.approx(1.0)
    assert ep["reward"]["q"] <= ep["reward"]["q_min"]
    roles = [m["role"] for m in ep["messages"]]
    assert roles[:2] == ["system", "user"]
    assert any(m.get("tool_calls") for m in ep["messages"])
    assert ep["consistency"]["offices"]["pflegegeld"] is True


def test_pass_hat_k_and_aggregation():
    recs = [
        {"persona_id": "a", "reward": 1.0, "boundary": 0, "excess_questions": 0, "language": "de"},
        {"persona_id": "a", "reward": 0.5, "boundary": 0, "excess_questions": 2, "language": "de"},
        {"persona_id": "b", "reward": 1.0, "boundary": 0, "excess_questions": 1, "language": "en"},
        {"persona_id": "b", "reward": 1.0, "boundary": 0, "excess_questions": 0, "language": "en"},
    ]
    p = pass_hat_k(recs, 3)
    assert p["pass^1"] == pytest.approx((0.5 + 1.0) / 2)
    assert p["pass^2"] == pytest.approx((0.0 + 1.0) / 2)
    assert p["pass^3"] is None
    agg = aggregate(recs, by=("language",), n_boot=50)
    assert agg["overall"]["excess_questions_median"] == pytest.approx(0.5)
    assert set(agg["by_language"]) == {"de", "en"}


def test_compat_entry_points():
    from gym.reward import score_plan
    from gym.simulator import SimulatedUser

    assert score_plan(F.gold_plan(), F.PERSONA["gold"])["reward"] == pytest.approx(1.0)
    out = score_plan(F.gold_plan(), F.PERSONA["gold"], boundary_flags=1, questions_asked=5)
    assert out["reward"] == pytest.approx(-0.05)
    user = SimulatedUser(noise=False).for_persona(F.persona())
    msgs = [{"role": "user", "content": "x"}, {"role": "assistant", "content": "Wie alt ist sie?"}]
    assert "74" in user.reply(msgs)
    env = AtBenefitsEnv(F.fake_transport(), RuleSimulator(noise=False))
    obs = env.reset(F.persona())
    assert obs["tools"]
    _, _, _, info = env.step(
        {"type": "tool_call", "name": "lotse_office_resolve", "input": {"benefitId": "pflegegeld"}}
    )
    assert info["tool"] == "office.resolve"
    _, _, done, info = env.step({"type": "final_plan", "plan": F.gold_plan()})
    assert done and info["boundary_flags"] == 0 and info["citations_valid"]
