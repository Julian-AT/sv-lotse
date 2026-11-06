"""Render + gold round trip, content validation and the model loop with a fake transport."""

from __future__ import annotations

import json

import pypdfium2 as pdfium
import pytest

from datagen.documents import content as C
from datagen.documents.generate import build_row, run_model_rounds
from datagen.documents.layout import PAGE_H
from datagen.documents.render import render, verify
from datagen.documents.spec import DOC_TYPES, build_spec


def persona(
    pid="p-test-1", goal="oegk-wahlarzt-kostenerstattung", scenario="private_doctor_refund", **kw
):
    subject = {
        "role": "subject",
        "age": 71,
        "sex": "f",
        "residence": {"state": "Wien", "district": 10},
        "insurance": {"carrier": "oegk", "status": "pensioner", "pension_carrier": "pva"},
        "employment": "retired",
        "income_band": "1000_2000",
        "care": {"pflegegeld_level": kw.get("level"), "needs": []},
        "children": [],
        "documents_held": ["e-card"],
        "language": "de",
        "register": "neutral",
        "literacy": "medium",
    }
    benefits = [goal, "medical-rehabilitation", "heilbehelfe-hilfsmittel", "oegk-physiotherapie"]
    office = kw.get("office", "oegk-wien")
    return {
        "id": pid,
        "split": kw.get("split", "train"),
        "goal": goal,
        "scenario": scenario,
        "life_situation": "after-hospital",
        "household": [subject],
        "gold": {"benefits": benefits, "offices": {b: office for b in benefits}},
    }


PERSONAS = [
    persona(),
    persona("p-test-2", "medical-rehabilitation", "rehab_after_hospital", office="pva-wien"),
    persona(
        "p-test-3",
        "pflegegeld",
        "care_for_parent",
        office="pva-wien",
        level=2,
        split="heldout_family",
    ),
    persona("p-test-4", "heilbehelfe-hilfsmittel", "aids_and_devices"),
]


def specs():
    out = []
    for p in PERSONAS:
        for t in DOC_TYPES:
            for seed in range(3):
                s = build_spec(p, t, seed)
                if s is not None:
                    out.append(s)
    return out


def sections_for(spec):
    return [] if spec.doc_type == "prescription" else C.parse(C.fake_content(spec))


def test_every_doc_type_is_built():
    assert {s.doc_type for s in specs()} == set(DOC_TYPES)


def test_spec_is_deterministic():
    a = build_spec(PERSONAS[1], "discharge_letter", 1)
    b = build_spec(PERSONAS[1], "discharge_letter", 1)
    assert a.to_json() == b.to_json()
    assert render(a, sections_for(a)).pdf == render(b, sections_for(b)).pdf


@pytest.mark.parametrize("spec", specs(), ids=lambda s: f"{s.persona_id}-{s.doc_type}-{s.seed}")
def test_render_gold_round_trip(spec):
    secs = sections_for(spec)
    assert spec.doc_type == "prescription" or C.validate(spec, secs) == []
    r = render(spec, secs)
    assert r.errors == []
    assert verify(r) == []
    for s in r.statements:
        page = r.pages[s["page"] - 1]
        assert page["text"][s["position"]["start"] : s["position"]["end"]] == s["quote"]
        assert s["type"] in {"documented_recommendation", "administrative_fact"}
    # brain page schema: text is the lines joined with newlines
    for page in r.pages:
        assert page["text"] == "\n".join(line["text"] for line in page["lines"])
    types = [s["fact_type"] for s in r.statements]
    if spec.doc_type == "discharge_letter":
        assert types.count("named_medicine") == len(spec.medicines)
        assert types.count("documented_recommendation") == len(spec.recommendations)
        assert "discharge_date" in types and "institution" in types
        assert r.exclusions, "clinical sentences are recorded as exclusions"
    if spec.doc_type in {"document_request", "reminder"}:
        assert types.count("requested_document") == len(spec.requested_documents)
        assert any(
            s["fact_type"] == "deadline" and s["quote"] == spec.deadline["date"]
            for s in r.statements
        )
        exp = r.explanation
        assert exp["by_when"]["date"] == spec.deadline["iso"]
        assert [a["document"] for a in exp["asked"]] == [d["id"] for d in spec.requested_documents]
    if spec.doc_type == "decision":
        assert "appeal_info" in types and "deadline" in types
    # no gold statement is a clinical sentence (FR-D3)
    clinical = {x["quote"] for x in r.exclusions}
    assert not any(s["quote"] in clinical for s in r.statements)


def test_bboxes_match_pdf_characters():
    """Single-line quotes: our bbox equals the union of pdfium's character boxes
    (left edge ±1.5 pt, right edge ±3.5 pt for glyph side bearings, height ±2.5 pt)."""
    checked = 0
    for spec in specs()[:24]:
        r = render(spec, sections_for(spec))
        doc = pdfium.PdfDocument(r.pdf)
        for s in r.statements:
            if "\n" in s["quote"] or len(s["quote"]) < 4:
                continue
            if r.pages[s["page"] - 1]["text"].count(s["quote"]) != 1:
                continue  # ambiguous search hit
            page = doc[s["page"] - 1]
            tp = page.get_textpage()
            searcher = tp.search(s["quote"], match_case=True)
            hit = searcher.get_next()
            searcher.close()
            if hit is None:
                tp.close()
                continue
            idx, count = hit
            boxes = [tp.get_charbox(i) for i in range(idx, idx + count)]
            boxes = [b for b in boxes if b[2] > b[0]]
            tp.close()
            x0 = min(b[0] for b in boxes)
            x1 = max(b[2] for b in boxes)
            top = PAGE_H - max(b[3] for b in boxes)
            bottom = PAGE_H - min(b[1] for b in boxes)
            bb = s["bbox"]
            W, H = 595.2756, 841.8898
            assert abs(bb["x"] * W - x0) < 1.5, (s["quote"], bb, x0)
            assert abs((bb["x"] + bb["width"]) * W - x1) < 3.5, (s["quote"], bb, x1)
            assert bb["y"] * H - 2.5 <= top and bottom <= (bb["y"] + bb["height"]) * H + 2.5
            checked += 1
        doc.close()
    assert checked > 50


def test_validate_rejects_boundary_violations():
    spec = build_spec(PERSONAS[1], "discharge_letter", 0)
    raw = C.fake_content(spec)
    recs = raw["sections"][-1]["sentences"]
    recs[0]["text"] = "Aufgrund der Diagnose wird eine Rehabilitation empfohlen."
    recs.append({"text": "Bitte Pantoprazol weiter einnehmen.", "role": "other", "rec": None})
    recs.append({"text": "Termin am 31.12.2031.", "role": "administrative", "rec": None})
    errors = C.validate(spec, C.parse(raw))
    assert any("medical reason" in e for e in errors)
    assert any("Pantoprazol" in e for e in errors)
    assert any("31.12.2031" in e for e in errors)
    raw = C.fake_content(spec)
    last = raw["sections"][-1]
    last["sentences"] = [s for s in last["sentences"] if s["role"] != "recommendation"]
    assert any("must appear exactly once" in e for e in C.validate(spec, C.parse(raw)))


def test_model_rounds_retry_and_rows(cfg):
    from datagen.documents import fake
    from datagen.llm import LLM
    from datagen.transport import FakeTransport

    batch = [s for s in specs() if s.seed == 0][:12]
    for s in batch:
        fake.register(s)
    calls = {"n": 0}

    def responder(body):
        calls["n"] += 1
        user = body["messages"][-1]["content"]
        if "rejected" not in user and calls["n"] % 3 == 0:
            return json.dumps({"sections": []})  # invalid first answer for some documents
        return fake.responder(body)

    llm = LLM("documents", transport=FakeTransport(responder, batch_api=False), config=cfg)
    outcomes = run_model_rounds(batch, llm, log=lambda m: None)
    assert all(o.sections is not None for o in outcomes)
    assert any(o.attempts == 2 for o in outcomes)
    for o in outcomes:
        row, problems = build_row(o, scan_share=0.0)
        assert problems == [] and row is not None
        assert row["pdf"].startswith(b"%PDF")
        statements = json.loads(row["statements"])
        assert row["n_statements"] == len(statements) > 0
        assert json.loads(row["pages"])[0]["method"] == "text_layer"


def test_scan_boxes_and_ocr():
    from datagen.documents import scan

    spec = build_spec(PERSONAS[0], "document_request", 0)
    r = render(spec, sections_for(spec))
    p = scan.params(7) | {"angle": 0.0}
    pngs = scan.simulate(r.pdf, p)
    assert len(pngs) == len(r.pages)
    w, h = scan.png_size(pngs[0])
    assert abs(w - 1240) <= 2 and abs(h - 1754) <= 2  # A4 at 150 DPI
    mapped = scan.map_boxes(r.statements, p, (w, h))
    s = r.statements[0]
    assert mapped[s["id"]] == pytest.approx(s["bbox"], abs=1e-3)
    rotated = scan.map_boxes(r.statements, p | {"angle": 2.0}, (w, h))
    assert rotated[s["id"]]["width"] >= s["bbox"]["width"]
    res = scan.ocr(pngs[:1])
    if res["available"]:
        assert res["pages"][0]["words"] > 20
