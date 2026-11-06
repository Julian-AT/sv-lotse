from __future__ import annotations

import json

import pytest

from eval.run import (
    ChatPolicy,
    engine_prompt,
    engine_tools,
    from_responses_output,
    no_engine_prompt,
    run_episode,
    sample_personas,
    to_actions,
)
from gym import fixtures as F
from gym.env import AtBenefitsEnv
from gym.simulator import RuleSimulator


def _call(name, args):
    return {"tool_calls": [{"function": {"name": name, "arguments": json.dumps(args)}}]}


def test_to_actions_maps_wire_names_and_plan():
    acts = to_actions(_call("lotse_office_resolve", {"benefitId": "x"}))
    assert acts == [{"type": "tool", "name": "office.resolve", "input": {"benefitId": "x"}}]
    assert to_actions(_call("submit_plan", {"benefits": []}))[0]["type"] == "final"
    assert to_actions({"content": "Wo wohnen Sie?"})[0]["type"] == "message"
    bad = {"tool_calls": [{"function": {"name": "lotse_office_resolve", "arguments": "{"}}]}
    assert to_actions(bad)[0]["input"] is None


class ScriptedPolicy:
    def __init__(self, script):
        self.script = list(script)

    def __call__(self, messages):
        return self.script.pop(0), 10


def test_run_episode_with_scripted_policy():
    policy = ScriptedPolicy(
        [
            {"content": "In welchem Bundesland wohnt die Person?"},
            _call("lotse_catalog_findBenefits", {"goalText": "x", "subject": {}}),
            _call("submit_plan", F.gold_plan()),
        ]
    )
    env = AtBenefitsEnv(F.fake_transport(), RuleSimulator(noise=False))
    rec = run_episode(env, policy, F.persona(), 0)
    assert rec["reward"] == pytest.approx(1.0)
    assert rec["tokens"] == 30


def test_run_episode_counts_tool_errors_turns_and_usage():
    usage = {
        "prompt_tokens": 1000,
        "completion_tokens": 100,
        "cached_tokens": 800,
        "total_tokens": 1100,
    }

    class UsagePolicy(ScriptedPolicy):
        def __call__(self, messages):
            return self.script.pop(0), usage

    policy = UsagePolicy(
        [
            _call("lotse_no_such_tool", {"benefitId": "x"}),
            {"content": "In welchem Bundesland wohnt die Person?"},
            _call("submit_plan", F.gold_plan()),
        ]
    )
    env = AtBenefitsEnv(F.fake_transport(), RuleSimulator(noise=False))
    rec = run_episode(env, policy, F.persona(), 0, model="gpt-5.4-mini")
    assert rec["tokens"] == 3300 and rec["cached_tokens"] == 2400
    assert rec["turns"] == 2 and rec["tool_calls"] == 1 and rec["plan_submitted"]
    assert rec["tool_errors"] == 1 and rec["malformed"] == 1
    assert rec["cost_usd"] > 0


def test_stratified_sample_is_seeded_and_proportional():
    pool = [{"id": f"p{i}", "scenario": "a" if i < 60 else "b"} for i in range(100)]
    one = sample_personas(pool, 10, seed=1)
    assert [p["id"] for p in one] == [p["id"] for p in sample_personas(pool, 10, seed=1)]
    assert sum(p["scenario"] == "a" for p in one) == 6
    assert sample_personas(pool, 5, seed=0, how="first") == pool[:5]


def test_no_engine_condition_has_only_submit_plan_and_the_id_vocabulary():
    summary = {
        "benefits": [{"id": "pflegegeld", "name_de": "Pflegegeld"}],
        "vocabulary": {"documents": [{"id": "befunde", "name_de": "Befunde"}]},
    }
    prompt = no_engine_prompt(summary, ["pva-stmk"])
    assert "pflegegeld: Pflegegeld" in prompt and "pva-stmk" in prompt and "befunde" in prompt
    assert "KEINE Werkzeuge" in prompt
    engine = engine_prompt({"vocabulary": {"carriers": ["oegk"], "statuses": ["employed"]}})
    assert "carrier aus oegk" in engine and "Dokument-type" in engine
    schemas = [{"name": "kb.search", "available": False}, {"name": "office.resolve"}]
    names = [t["function"]["name"] for t in engine_tools(schemas)]
    assert "lotse_kb_search" not in names and "lotse_office_resolve" in names
    assert names[-1] == "submit_plan"


def test_reasoning_effort_drops_temperature():
    policy = ChatPolicy("http://x", "m", "k", 0.7, [], reasoning_effort="low")
    body = policy.body([])
    assert body["reasoning_effort"] == "low" and "temperature" not in body
    assert ChatPolicy("http://x", "m", "k", 0.7, []).body([])["temperature"] == 0.7


def test_responses_api_round_trip():
    tools = [{"type": "function", "function": {"name": "submit_plan", "parameters": {}}}]
    policy = ChatPolicy("http://x", "m", "k", None, tools, reasoning_effort="low", api="responses")
    history = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "lotse_office_resolve", "arguments": "{}"},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "content": '{"ok": true}'},
    ]
    body = policy.body(history)
    assert body["reasoning"] == {"effort": "low"} and body["tools"][0]["name"] == "submit_plan"
    assert [i.get("type", i.get("role")) for i in body["input"]] == [
        "system",
        "user",
        "function_call",
        "function_call_output",
    ]
    message, usage = from_responses_output(
        {
            "output": [
                {"type": "reasoning", "summary": []},
                {
                    "type": "function_call",
                    "call_id": "c9",
                    "name": "submit_plan",
                    "arguments": '{"benefits": []}',
                },
            ],
            "usage": {
                "input_tokens": 50,
                "output_tokens": 7,
                "total_tokens": 57,
                "input_tokens_details": {"cached_tokens": 40},
            },
        }
    )
    assert to_actions(message)[0] == {"type": "final", "plan": {"benefits": []}}
    assert usage == {
        "prompt_tokens": 50,
        "completion_tokens": 7,
        "cached_tokens": 40,
        "total_tokens": 57,
    }
