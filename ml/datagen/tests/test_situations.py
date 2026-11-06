from __future__ import annotations

from collections import Counter

from datagen.situations.naturalize import rule_checks
from datagen.situations.prompts import build_messages, card_language, variant_for

HH = [
    {
        "role": "subject",
        "age": 82,
        "sex": "f",
        "residence": {"state": "Wien", "district": 16},
        "insurance": {"carrier": "oegk", "status": "pensioner", "pension_carrier": "pva"},
        "employment": "retired",
        "income_band": "lt_1300",
        "care": {"pflegegeld_level": None, "needs": ["mobility"]},
        "children": [],
        "documents_held": ["e-card"],
        "language": "de-AT",
        "register": "neutral",
        "literacy": "medium",
    }
]


def test_variant_distribution(cfg):
    c = Counter(variant_for(f"p-{i:07d}")[0] for i in range(20000))
    assert set(c) == {lang["code"] for lang in cfg.languages}
    assert abs(c["de"] / 20000 - 0.22) < 0.02
    assert card_language("bcs", "Serbian") == "sr" and card_language("de-easy", None) == "de-AT"


def test_rule_checks():
    ok = rule_checks(
        "Meine Mutter ist 82 und wohnt im 16. Bezirk. Sie hat unter 1.300 Euro im "
        "Monat und kann nicht mehr gut gehen. Was können wir tun?",
        "de",
        HH,
        ["pflegegeld"],
    )
    assert ok["rule_passed"], ok
    bad = rule_checks(
        "Meine Mutter ist 82, sie braucht Pflegegeld, sie hat 2.500 Euro im Monat "
        "und kann nicht gut gehen.",
        "de",
        HH,
        ["pflegegeld"],
    )
    assert not bad["rule_passed"]
    assert bad["leak_hits"] == ["pflegegeld"] and bad["unexpected_numbers"] == [2500]
    lang = rule_checks(
        "My mother is 82 and lives in Vienna, she cannot walk well any more and "
        "we do not know what to do.",
        "hu",
        HH,
        [],
    )
    assert any(r.startswith("language") for r in lang["rule_reasons"])


def test_prompt_mentions_target_language():
    row = {"id": "p-1", "style": "plain", "situation_text": "Meine Mutter ist 82."}
    msgs = build_messages(row, HH, {"partial_knowledge": 0.3, "contradiction": 0.2}, "hu", None, {})
    assert msgs[1]["content"].endswith("Write the message in Hungarian (magyar).")
    assert "Pflegegeld" in msgs[0]["content"]  # named only as a forbidden example
