"""Model card for publish.model (no network, no torch)."""

import yaml

from publish.model import eval_table, model_card

CFG = {
    "model": "Qwen/Qwen3-8B",
    "max_length": 8192,
    "lora": {"r": 64, "alpha": 128, "dropout": 0.05, "target_modules": "all-linear"},
    "train": {"lr": 1e-4},
    "data": {"source": "hf"},
}
TRAIN = {
    "git_sha": "abc1234",
    "data": {
        "hash": "sha256:feed",
        "hf": {"tiers": ["O", "A", "B"], "revision": "r1", "tool_max_chars": 1500},
        "length_filter": {"dropped": 3},
    },
    "metrics": {"train_loss": 0.4, "global_steps": 10},
}
BASE = {"split": "test", "metrics": {"n": 200, "mean_reward": 0.2, "reward_ci95": [0.1, 0.3]}}
SFT = {"split": "test", "metrics": {"n": 200, "mean_reward": 0.7, "reward_ci95": [0.6, 0.8]}}


def test_card_has_licence_datasets_eval_and_boundary():
    card = model_card("JulianAT/x", CFG, TRAIN, BASE, SFT, merged=False)
    front = yaml.safe_load(card.split("---")[1])
    assert front["license"] == "apache-2.0" and front["base_model"] == "Qwen/Qwen3-8B"
    assert front["datasets"] == ["JulianAT/at-benefits", "JulianAT/at-sv-law"]
    assert "not for production medical or legal advice" in card.lower()
    assert "sha256:feed" in card and "abc1234" in card
    assert "| 0.200 | 0.700 | 0.500 |" in card


def test_eval_table_without_results():
    assert "No evaluation results" in eval_table(None, None)
