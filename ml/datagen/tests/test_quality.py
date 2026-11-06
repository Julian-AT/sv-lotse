from __future__ import annotations

from datagen import quality as q
from datagen.llm import LLM
from datagen.transport import FakeTransport


def test_language():
    assert q.language_ok("Grüß Gott, i hob a Frage wegen meiner Mama, de is im Spital.", "de")[0]
    assert q.language_ok("Zdravo, trebam pomoć za mamu, ona je u bolnici već tri dana.", "bcs")[0]
    assert not q.language_ok("Hello, I need help with my mother who is in hospital.", "de")[0]


def test_dedup_and_metrics():
    items = [
        {"id": "a", "text": "Meine Mutter braucht Pflege zu Hause, was kann ich tun?"},
        {"id": "b", "text": "Meine Mutter braucht Pflege zu Hause, was kann ich tun??"},
        {"id": "c", "text": "Ich habe ein Kind bekommen und weiß nicht, was mir zusteht."},
    ]
    kept, dropped = q.dedup(items)
    assert [k["id"] for k in kept] == ["a", "c"] and dropped == {"b": "a"}
    assert 0 < q.distinct_n([i["text"] for i in items], 2) <= 1
    assert q.length_stats([i["text"] for i in items])["n"] == 3
    assert "wiener_sachtextformel" in q.readability(items[0]["text"], "de-easy")
    assert "flesch_reading_ease" in q.readability("I need help. It is hard.", "en")


def test_leaks():
    terms = q.leak_terms(
        {"benefits": ["pflegegeld"], "offices": [{"name": "PVA Wien"}]},
        {"benefits": [{"id": "pflegegeld", "names": {"de": "Pflegegeld"}}]},
    )
    assert q.find_leaks("Kann ich PFLEGEGELD bekommen?", terms) == ["Pflegegeld", "pflegegeld"]
    assert q.find_leaks("Meine Mutter braucht Pflege.", terms) == []


def test_judge(cfg):
    llm = LLM("situations", transport=FakeTransport(batch_api=False), config=cfg)
    rubric = {
        "criteria": [
            {"id": "faithful", "description": "only card facts"},
            {"id": "no_leak", "description": "no benefit names"},
        ]
    }
    out = q.judge([{"id": "x1", "content": "text"}], rubric, llm=llm, max_output_tokens=100)
    assert set(out) == {"x1"} and "passed" in out["x1"]


def test_merge_readme():
    from datagen.publish import merge_readme

    r1 = merge_readme(None, "situations", ["train", "test"], "## Situations\nA", "v0.2")
    r2 = merge_readme(r1, "dialogues", ["train"], "## Dialogues\nB", "v0.2")
    r3 = merge_readme(r2, "situations", ["train"], "## Situations\nC", "v0.3")
    assert "## Situations\nC" in r3 and "## Situations\nA" not in r3 and "## Dialogues" in r3
    import yaml

    meta = yaml.safe_load(r3.split("---")[1])
    assert [c["config_name"] for c in meta["configs"]] == ["situations", "dialogues"]
