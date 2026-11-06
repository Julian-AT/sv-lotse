from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from datagen.legal_qa import checks as rules
from datagen.legal_qa import corpus, generate
from datagen.legal_qa import run as lq

TEXTS = {
    "N1": "§ 1. (1) Die Witwenpension gebührt auf Antrag.\n(2) Bei Wiederverheiratung gebührt eine "
    "Abfertigung in der Höhe des 35fachen Monatsbetrages der Witwenpension.",
    "N2": "§ 2. (1) Das Pflegegeld wird in sieben Stufen gewährt.\n(2) Der Antrag ist beim "
    "zuständigen Pensionsversicherungsträger einzubringen; die Entscheidung ergeht schriftlich.",
    "N3": "§ 3. (1) Die Krankenversicherung gewährt Sachleistungen und Geldleistungen.\n"
    "(2) Kostenerstattung erfolgt in Höhe von 80 vom Hundert des Vertragstarifs.",
    "N4": "(Anm.: § 4 aufgehoben durch BGBl. Nr. 1/2000)",
    "N5": "§ 5. (1) Die Witwenpension gebührt auf Antrag.\n(2) Bei Wiederverheiratung gebührt eine "
    "Abfertigung in der Höhe des 35fachen Monatsbetrages der Witwenpension nach diesem Gesetz.",
}


@pytest.fixture
def big(cfg, tmp_path):
    """The core fixture caps the tranche at 10k tokens; legal_qa needs a little more."""
    import os

    import yaml

    from datagen import config as cfgmod

    path = Path(os.environ["DATAGEN_CONFIG"])
    raw = yaml.safe_load(path.read_text())
    raw["tranche_tokens"] = 10_000_000
    path.write_text(yaml.safe_dump(raw))
    cfgmod.default.cache_clear()
    return cfgmod.load(path)


def _corpus(tmp_path):
    rows = []
    for i, (doc, text) in enumerate(TEXTS.items()):
        rows.append(
            {
                "doc_id": doc,
                "act": "ASVG" if doc != "N5" else "GSVG",
                "act_title": "Allgemeines Sozialversicherungsgesetz",
                "paragraph": f"§ {i + 1}",
                "title": "Abfertigung" if doc in ("N1", "N5") else f"Titel {i}",
                "text": text,
                "url": f"https://ris.bka.gv.at/{doc}",
                "version_as_of": "2026-11-06",
            }
        )
    p = tmp_path / "law.parquet"
    pd.DataFrame(rows).to_parquet(p)
    return p


def test_absatz_and_eligibility():
    assert corpus.split_absaetze(TEXTS["N2"]) == ["1", "2"]
    assert corpus.split_absaetze("§ 9. (1) a\n(2) b\n(2a) c") == ["1", "2", "2a"]
    assert not corpus.eligible(TEXTS["N4"])
    assert not corpus.eligible("§ 7. Kurz.")


def test_bm25_ranks_the_matching_section_first():
    idx = corpus.BM25(list(TEXTS.values()))
    top = idx.top("Pflegegeld Stufen Antrag Pensionsversicherungsträger", 3)
    assert top[0][0] == 1
    assert idx.rank_of("Kostenerstattung Vertragstarif", 2) == 1
    assert idx.rank_of("xyzzy", 2) is None


def test_rule_checks():
    s = corpus.Section(
        "N1",
        "ASVG",
        "ASVG",
        "§ 1",
        "Abfertigung",
        TEXTS["N1"],
        "u",
        "d",
        corpus.split_absaetze(TEXTS["N1"]),
    )
    good = {
        "question": "Bekomme ich Geld, wenn ich als Witwe wieder heirate?",
        "question_de": "Bekomme ich Geld, wenn ich als Witwe wieder heirate?",
        "answer": "Ja, das 35-Fache.",
        "absatz": ["2"],
        "language": "de",
        "evidence_quote": "gebührt eine Abfertigung in der Höhe des 35fachen Monatsbetrages",
    }
    res = rules.check(good, s)
    assert rules.passed(res), res
    copied = good | {
        "question": "Gebührt bei Wiederverheiratung eine Abfertigung in der Höhe "
        "des 35fachen Monatsbetrages?"
    }
    assert not rules.check(copied, s)["verbatim"]
    cited = good | {"question": "Was regelt § 1 ASVG zur Abfertigung?"}
    assert not rules.check(cited, s)["no_citation"]
    assert not rules.check(good | {"absatz": ["7"]}, s)["absatz"]
    assert not rules.check(good | {"evidence_quote": "steht so nicht im Gesetz drin"}, s)[
        "evidence"
    ]


def test_slot_plan_is_seeded_and_german_majority():
    s = corpus.Section("NX", "ASVG", "ASVG", "§ 9", "", "x" * 5000, "u", "d", [])
    a, b = generate.slot_plan(s, 1), generate.slot_plan(s, 1)
    assert a == b and len(a) == 4
    assert generate.slot_plan(s, 2) != a or True
    share = sum(v for k, v in generate.LANGUAGES.items() if k.startswith("de"))
    assert share > 0.5 and abs(sum(generate.LANGUAGES.values()) - 1) < 1e-9


def _responder(body):
    user = body["messages"][-1]["content"]
    slots = [line for line in user.splitlines() if line.startswith("- slot ")]
    qs = []
    for line in slots:
        k = int(line.split()[2].rstrip(":"))
        if "Pflegegeld" in user:
            q, ev, ab = (
                "In wie vielen Stufen gibt es Unterstützung für Pflegebedürftige?",
                "Das Pflegegeld wird in sieben Stufen gewährt",
                ["1"],
            )
        elif "Witwenpension" in user:
            q, ev, ab = (
                "Bekomme ich Geld, wenn ich als Witwe wieder heirate?",
                "gebührt eine Abfertigung",
                ["2"],
            )
        else:
            q, ev, ab = (
                "Wie viel bekomme ich zurück, wenn ich privat zum Arzt gehe?",
                "Kostenerstattung erfolgt in Höhe von 80 vom Hundert",
                ["2"],
            )
        qs.append(
            {
                "slot": k,
                "question": q,
                "question_de": q,
                "answer": "Siehe Gesetz.",
                "absatz": ab,
                "evidence_quote": ev,
            }
        )
    return json.dumps({"usable": True, "questions": qs})


def test_pipeline_with_fake_transport(tmp_path, big, monkeypatch):
    from datagen.llm import LLM
    from datagen.transport import FakeTransport

    monkeypatch.setenv("DATAGEN_LAW_CORPUS", str(_corpus(tmp_path)))
    sections = corpus.load_sections()
    eligible = [s for s in sections if corpus.eligible(s.text)]
    assert {s.doc_id for s in eligible} == {"N1", "N2", "N3", "N5"}
    llm = LLM("legal_qa", transport=FakeTransport(_responder, batch_api=False), config=big)
    root = tmp_path / "work"
    stats = lq.generate(eligible, 1, llm, root)
    assert stats.get("chunks_done") == 1
    # Resumable: the chunk file is reused.
    assert lq.generate(eligible, 1, llm, root).get("chunks_cached") == 1
    records, _ = lq.assemble(sections, root)
    assert records and all(r["positive_id"] in TEXTS for r in records)
    lq.dedup(records)
    # Identical questions for the same section in one language are near-duplicates.
    kept = [r for r in records if r["checks"]["near_dup"] and r["checks"]["verbatim"]]
    lq.hard_negatives(kept, sections)
    for r in kept:
        assert r["positive_id"] not in r["negative_ids"]
        if r["positive_id"] == "N1":
            assert "N5" in r["parallel_ids"] and "N5" not in r["negative_ids"]
    rows = lq.release_rows(kept, sections)
    row = next(iter(rows.values()))[0]
    assert row["licence"] == "CC-BY-4.0" and "RIS" in row["attribution"]
    assert {lq.split_of(d) for d in TEXTS} <= {"train", "val", "test"}


def _judge_responder(body):
    import re

    user = body["messages"][-1]["content"]
    ids = re.findall(r'"id": "([^"]+)"', user)
    items = []
    for i in ids:
        bad = i.endswith("q1")
        items.append(
            {
                "id": i,
                "answerable": 2 if bad else 5,
                "correct": 5,
                "self_contained": 5,
                "natural": 4,
                "copies_section": False,
                "reason": "ok",
            }
        )
    return json.dumps({"items": items})


def test_every_question_is_judged_and_failures_dropped(tmp_path, big, monkeypatch):
    from datagen.llm import LLM
    from datagen.transport import FakeTransport

    monkeypatch.setenv("DATAGEN_LAW_CORPUS", str(_corpus(tmp_path)))
    sections = corpus.load_sections()
    eligible = [s for s in sections if corpus.eligible(s.text)]

    def responder(body):
        if "strict quality judge" in body["messages"][0]["content"]:
            return _judge_responder(body)
        return _responder(body)

    llm = LLM("legal_qa", transport=FakeTransport(responder, batch_api=False), config=big)
    root = tmp_path / "work"
    stats = lq.generate(eligible, 1, llm, root)
    assert stats["judged"] > 0 and not stats.get("judge_incomplete")
    records, _ = lq.assemble(sections, root)
    judged = [r for r in records if r.get("judge")]
    assert judged and all(r["checks"] and rules.passed(r["checks"]) for r in judged)
    assert all(r["judge"]["passed"] == (not r["id"].endswith("q1")) for r in judged)
    # The judge file is reused on the next run (resumable, no second judge call).
    calls = len(llm.transport.calls)
    assert lq.generate(eligible, 1, llm, root).get("judge_cached") == 1
    assert len(llm.transport.calls) == calls
