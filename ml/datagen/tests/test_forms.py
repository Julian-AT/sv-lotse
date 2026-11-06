from __future__ import annotations

import datetime as dt
import json
import shutil
from pathlib import Path

import pytest

from datagen.forms import identity as idm
from datagen.forms import release, scan
from datagen.forms.e13_mapping import fact_type_for

bun = pytest.mark.skipif(shutil.which("bun") is None, reason="bun not installed")

PERSONA = {
    "id": "p-000123",
    "split": "train",
    "household": [
        {
            "role": "subject",
            "age": 67,
            "sex": "f",
            "residence": {"state": "Wien", "district": 10},
            "insurance": {"carrier": "oegk", "status": "pensioner", "pension_carrier": "pva"},
            "employment": "retired",
            "income_band": "1300_2000",
            "care": {"pflegegeld_level": 3, "needs": []},
            "children": [],
            "documents_held": ["e-card"],
            "language": "de-AT",
            "register": "neutral",
            "literacy": "medium",
        },
        {
            "role": "helper",
            "age": 40,
            "sex": "m",
            "residence": {"state": "Wien", "district": 10},
            "insurance": {"carrier": "oegk", "status": "employed", "pension_carrier": None},
            "employment": "employed",
            "income_band": "2000_3000",
            "care": {"pflegegeld_level": None, "needs": []},
            "children": [],
            "documents_held": [],
            "language": "de-AT",
            "register": "neutral",
            "literacy": "high",
        },
    ],
}


def test_identity_is_deterministic_and_valid():
    a, facts_a, _ = idm.build_facts(PERSONA)
    b, facts_b, _ = idm.build_facts(PERSONA)
    assert facts_a == facts_b
    assert idm.valid_svnr(a["svnr"]) and a["svnr"].endswith(a["birth"].strftime("%d%m%y"))
    assert idm.valid_iban(a["iban"])
    age = (idm.TODAY - a["birth"]).days // 365.25
    assert int(age) == 67
    assert a["postcode"] == "1100" and a["city"] == "Wien"
    assert "helper" in a
    for f in facts_a:
        assert f["source"]["quote"].strip()
        if f["source"]["kind"] == "document":
            assert f["documentId"] == f["source"]["documentId"] and f["turnId"] is None
        else:
            assert f["turnId"] == f["source"]["turnId"] and f["documentId"] is None
    if a.get("email"):
        assert a["email"].split("@")[1].startswith("example.")


def test_iban_and_svnr_checks():
    assert idm.valid_iban("AT611904300234573201")
    assert not idm.valid_iban("AT611904300234573202")
    assert not idm.valid_svnr("1234567890")
    import random

    for k in range(50):
        rng = random.Random(k)
        assert idm.valid_svnr(idm._svnr(rng, dt.date(1950, 3, 1)))


def test_e13_mapping_is_conservative():
    assert (
        fact_type_for("Versicherungsnummer", "Antragsteller (implicit)", "text", "applicant")
        == "person.insurance_number"
    )
    assert fact_type_for("Datum", "Unterfertigung", "date", "applicant") == "application.date"
    # Spouse, lease and patient sections stay unmapped; checkboxes and provider fields too.
    assert fact_type_for("Versicherungsnummer", "für Patienten", "text", "applicant") is None
    assert (
        fact_type_for(
            "Name",
            "Die folgenden Fragen werden von mir wahrheitsgemäß beantwortet",
            "text",
            "applicant",
        )
        is None
    )
    assert fact_type_for("ja", "Antragsteller (implicit)", "checkbox", "applicant") is None
    assert fact_type_for("Vorname", "Kind", "text", "hospital") is None
    assert (
        fact_type_for("Vorname", "BEVOLLMÄCHTIGTE PERSON", "text", "applicant")
        == "representative.given_name"
    )


def test_rotate_box_identity_and_bounds():
    box = {"page": 1, "x": 100, "y": 200, "width": 50, "height": 10}
    same = scan.rotate_box(box, 0.0, 595, 842)
    assert same == {"page": 1, "x": 100, "y": 200, "width": 50, "height": 10}
    rot = scan.rotate_box(box, 1.5, 595, 842)
    assert rot["width"] > 50 and rot["height"] > 10
    # A counter-clockwise rotation moves a point left of centre downwards.
    assert rot["y"] + rot["height"] / 2 > 205


def test_missing_reason_labels():
    from datagen.forms.run import missing_reason

    field = {"id": "f1", "fact_type": "bank.iban"}
    doc = {
        "type": "bank.iban",
        "value": "AT611904300234573201",
        "confirmed": True,
        "source": {"kind": "document"},
    }
    assert missing_reason(field, [doc], "t") == "iban_not_stated"
    assert missing_reason(field, [], "t") == "no_fact"
    assert missing_reason({"id": "f2"}, [], "t") == "unmapped"
    a = {"type": "contact.phone", "value": "1", "confirmed": True, "source": {"kind": "statement"}}
    b = {**a, "value": "2"}
    assert missing_reason({"id": "f3", "fact_type": "contact.phone"}, [a, b], "t") == "ambiguous"


@bun
def test_bridge_reproduces_e7_gold():
    from datagen.forms.run import e7_parity
    from datagen.forms.templates import all_templates

    parity = e7_parity(all_templates())
    assert parity["cases"] == 21
    assert parity["nonempty_exact"] == parity["expected_nonempty"] == 218
    assert parity["blank_correct"] == parity["expected_blank"]


@bun
def test_shard_end_to_end(tmp_path, cfg, monkeypatch):
    from datagen.forms import run
    from datagen.forms.templates import all_templates

    templates = {t.ref: t for t in all_templates()}
    t = templates["e13-svs-027"]  # flat power of attorney: subject and representative fields
    desc = run.describe_templates([t])[t.uuid]
    personas = [PERSONA, {**PERSONA, "id": "p-000124"}]
    summary = run.run_shard(t, desc, personas, 0, renders=2, root=tmp_path, scan_share=1.0, seed=0)
    assert summary["instances"] == 2 and not summary["errors"]
    inst = [json.loads(x) for x in (tmp_path / "instances/e13-svs-027.000.jsonl").open()]
    fields = inst[0]["fields"]
    filled = [f for f in fields if f["status"] == "filled"]
    assert filled and all(f["provenance"]["source"]["quote"] for f in filled)
    assert all(f["value"] is None for f in fields if f["signature_required"])
    assert any(f["status"] == "missing:unmapped" for f in fields)
    det = [json.loads(x) for x in (tmp_path / "detection/e13-svs-027.000.jsonl").open()]
    kinds = {d["kind"] for d in det}
    assert kinds == {"flat", "scan"}
    assert all(len(d["boxes"]) == len(fields) for d in det)
    for d in det:
        assert (tmp_path / d["pdf"]).stat().st_size > 1000
    # Resumable: a second call returns the stored summary without rerunning.
    assert run.run_shard(t, desc, personas, 0, 2, tmp_path, 1.0, 0) == summary
    # Release rows embed the SVS PDFs (redistributable with attribution).
    # Rows whose product render failed (glyphs outside WinAnsi) keep their gold but no PDF.
    rel = release.build_release(tmp_path)
    rendered = sum(1 for i in inst if not i["render_error"])
    assert rendered >= 1
    assert rel["rows"] == {"train": 2} and rel["rows_with_pdf"] == rendered


def test_judge_pass_with_fake_transport(tmp_path, cfg):
    import os

    import yaml

    from datagen import config as cfgmod

    path = Path(os.environ["DATAGEN_CONFIG"])
    raw = yaml.safe_load(path.read_text())
    raw["tranche_tokens"] = 10_000_000
    path.write_text(yaml.safe_dump(raw))
    cfgmod.default.cache_clear()
    cfg = cfgmod.load(path)

    from datagen.forms.run import judge_pass
    from datagen.llm import LLM
    from datagen.transport import FakeTransport

    inst = {
        "id": "x:p-1",
        "template_ref": "x",
        "template_title": "Formular",
        "fields": [
            {
                "label_de": "Vorname",
                "type": "text",
                "section": None,
                "status": "filled",
                "value": "Anna",
                "owner": "applicant",
            }
        ],
    }
    (tmp_path / "instances").mkdir()
    (tmp_path / "instances/x.000.jsonl").write_text(json.dumps(inst) + "\n")

    def responder(body):
        scores = [{"criterion": c, "score": 5} for c in ("label_fit", "consistency", "boundary")]
        return json.dumps({"scores": scores, "passed": True, "reason": "ok"})

    llm = LLM("forms", transport=FakeTransport(responder, batch_api=False), config=cfg)
    out = judge_pass(tmp_path, 5, llm=llm)
    assert out["n"] == 1 and out["pass_rate"] == 1.0 and out["judge_errors"] == 0
