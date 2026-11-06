"""Live test against the research tool server; skipped when it is not running."""

from __future__ import annotations

import os

import pytest

from gym import fixtures as F
from gym.data import load_personas
from gym.env import AtBenefitsEnv
from gym.oracle import run_oracle_episode
from gym.paths import DATA_DIR, DEFAULT_SERVER
from gym.simulator import RuleSimulator
from gym.transport import HttpTransport

SERVER = os.environ.get("LOTSE_GYM_SERVER", DEFAULT_SERVER)
transport = HttpTransport(SERVER)
pytestmark = pytest.mark.skipif(not transport.health(), reason=f"no tool server at {SERVER}")


def test_invalid_input_is_rejected():
    result = transport.call_tool("catalog.findBenefits", {"unexpected": True})
    assert not result.ok


def test_oracle_episodes_score_high():
    path = os.environ.get("LOTSE_PERSONAS", str(DATA_DIR / "personas"))
    personas = load_personas(path, "train", 3) if os.path.exists(path) else []
    if not personas:
        personas = [F.persona()]
    for persona in personas:
        env = AtBenefitsEnv(transport, RuleSimulator(noise=False))
        episode = run_oracle_episode(env, persona)
        assert episode["reward"]["boundary"] == 0
        assert episode["reward"]["reward"] >= 0.9, episode["reward"]
