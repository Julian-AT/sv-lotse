from __future__ import annotations

import json

import pytest

from eval.run import run_episode, to_actions
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
