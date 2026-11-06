"""Release writer and judge pass for the `forms` family.

One Parquet row per (template, persona) instance with the field-level gold, the detection gold
of its rendered flat and scanned PDFs, and the PDF bytes where the publisher's terms permit
redistribution (SVS forms, with attribution). SV-Box PDFs stay local unless
`include_local_pdfs` is set for a private build.
"""

from __future__ import annotations

import json
import random
from collections import defaultdict
from pathlib import Path

from datagen import io

SHARD_BYTES = 200_000_000

JUDGE_RUBRIC = {
    "instructions": (
        "You see an official Austrian administrative form that a software pilot pre-filled from "
        "a synthetic person's confirmed facts. Only the applicant's own administrative fields may "
        "be filled; doctor, hospital and office sections and signatures must stay empty. Judge "
        "the filled values only (empty fields are correct by policy). Dates are ISO 8601 "
        "(YYYY-MM-DD) by design. Insurance numbers and IBANs were already validated "
        "programmatically (check "
        "digits); do not recompute them. Persons are synthetic."
    ),
    "criteria": [
        {
            "id": "label_fit",
            "description": "Every filled value fits its field label and type "
            "(a name in a name field, a date in a date field, an insurance number in a "
            "VSNR field).",
        },
        {
            "id": "consistency",
            "description": "Filled values are mutually consistent and "
            "plausible for one Austrian person (name parts, birth date, postcode and city).",
        },
        {
            "id": "boundary",
            "description": "No value appears in a doctor, hospital, office or "
            "signature field, and no medical content was invented.",
        },
    ],
    "pass_rule": "every criterion scores at least 4",
}


def _rows(root: Path, sub: str):
    for path in sorted((root / sub).glob("*.jsonl")):
        with path.open() as fh:
            for line in fh:
                yield json.loads(line)


def judge_item(inst: dict) -> dict:
    filled = [
        {"label": f["label_de"], "type": f["type"], "section": f["section"], "value": f["value"]}
        for f in inst["fields"]
        if f["status"] == "filled"
    ]
    provider = [
        {"label": f["label_de"], "owner": f["owner"], "value": f["value"]}
        for f in inst["fields"]
        if f["status"].startswith(("provider", "signature"))
    ]
    return {
        "id": inst["id"],
        "content": {
            "form": inst["template_title"],
            "filled": filled,
            "provider_and_signature_fields": provider[:40],
        },
    }


def stratified_sample(root: Path, n: int, seed: int = 0) -> list[dict]:
    by_template = defaultdict(list)
    for inst in _rows(root, "instances"):
        if any(f["status"] == "filled" for f in inst["fields"]):
            by_template[inst["template_ref"]].append(inst)
    rng = random.Random(seed)
    per = max(1, n // max(len(by_template), 1))
    out = []
    for ref in sorted(by_template):
        items = by_template[ref]
        out.extend(rng.sample(items, min(per, len(items))))
    return out[:n] if len(out) > n else out


def run_judge(root: Path, n: int, llm) -> dict:
    from datagen.quality import judge, wilson

    sample = stratified_sample(root, n)
    items = {i["id"]: judge_item(i) for i in sample}
    verdicts: dict = {}
    for _ in range(4):  # judge errors (for example 429 from a busy proxy) are retried
        todo = [items[k] for k in items if k not in verdicts]
        if not todo:
            break
        for k, v in judge(todo, JUDGE_RUBRIC, llm=llm).items():
            if not str(v.get("reason", "")).startswith("judge error"):
                verdicts[k] = v
    (root / "judge.jsonl").write_text(
        "".join(json.dumps({"id": k, **v}, ensure_ascii=False) + "\n" for k, v in verdicts.items())
    )
    passed = sum(v["passed"] for v in verdicts.values())
    scores = defaultdict(list)
    for v in verdicts.values():
        for c, s in v["scores"].items():
            scores[c].append(s)
    return {
        "n": len(verdicts),
        "passed": passed,
        "pass_rate": round(passed / len(verdicts), 4) if verdicts else None,
        "pass_rate_ci95": wilson(passed, len(verdicts)),
        "mean_scores": {c: round(sum(s) / len(s), 3) for c, s in scores.items()},
        "judge_errors": len(sample) - len(verdicts),
    }


def build_release(root: Path, include_local_pdfs: bool = False) -> dict:
    detections = defaultdict(list)
    for d in _rows(root, "detection"):
        detections[d["instance_id"]].append(d)
    buffers: dict[str, list] = defaultdict(list)
    sizes: dict[str, int] = defaultdict(int)
    index: dict[str, int] = defaultdict(int)
    counts: dict[str, int] = defaultdict(int)
    pdf_rows = 0

    def flush(split: str):
        if buffers[split]:
            io.write_release_shard("forms", split, index[split], buffers[split])
            index[split] += 1
            buffers[split], sizes[split] = [], 0

    for inst in _rows(root, "instances"):
        ship = inst["pdf_redistributable"] or include_local_pdfs
        blobs = {}
        for kind in ("filled", "flat", "scan"):
            rel = inst["pdf"].get(kind)
            blobs[kind] = (root / rel).read_bytes() if (ship and rel) else None
        det = {d["kind"]: d for d in detections.get(inst["id"], [])}
        row = {
            "id": inst["id"],
            "split": inst["split"],
            "template_ref": inst["template_ref"],
            "template_id": inst["template_id"],
            "template_title": inst["template_title"],
            "template_format": inst["template_format"],
            "template_source": inst["template_source"],
            "template_sha256": inst["template_sha256"],
            "publisher": inst["publisher"],
            "persona_id": inst["persona_id"],
            "persona": json.dumps(inst["persona"], ensure_ascii=False),
            "facts": json.dumps(inst["facts"], ensure_ascii=False),
            "fields": json.dumps(inst["fields"], ensure_ascii=False),
            "missing_fields": inst["missing_fields"],
            "signature_fields": inst["signature_fields"],
            "requires_handwritten_signature": inst["requires_handwritten_signature"],
            "n_filled": inst["counts"].get("filled", 0),
            "n_fields": len(inst["fields"]),
            "render_error": inst.get("render_error"),
            "pdf_filled": blobs["filled"],
            "pdf_flat": blobs["flat"],
            "pdf_scan": blobs["scan"],
            "detection_flat": json.dumps(det["flat"]["boxes"], ensure_ascii=False)
            if "flat" in det
            else None,
            "detection_scan": json.dumps(det["scan"]["boxes"], ensure_ascii=False)
            if "scan" in det
            else None,
            "scan_params": json.dumps(det["scan"]["scan"]) if "scan" in det else None,
            "page_sizes": json.dumps((det.get("flat") or det.get("scan") or {}).get("pages")),
            "attribution": inst["attribution"],
            "terms": inst["terms"],
            "pdf_redistributable": inst["pdf_redistributable"],
        }
        pdf_rows += any(blobs.values())
        split = inst["split"]
        buffers[split].append(row)
        sizes[split] += sum(len(b) for b in blobs.values() if b) + len(row["fields"])
        counts[split] += 1
        if sizes[split] >= SHARD_BYTES:
            flush(split)
    for split in list(buffers):
        flush(split)
    return {"rows": dict(counts), "rows_with_pdf": pdf_rows, "shards": dict(index)}


CARD = """## forms

Filled official Austrian forms with field-level gold and field-detection gold.

- **Templates.** {templates} registered templates of the SV KI-Lotse form registry: the seven
  SV-Box AcroForm applications (catalog schemas from `packages/knowledge/forms`) and the twenty
  flat SVS forms of the E13 gold set (hand-drawn answer areas, one-based pages, PDF points,
  top-left CropBox origin).
- **Values come from the product.** For each (template, persona) the confirmed facts of a
  synthetic AT-Benefits persona (with statement or document provenance and quotes) are passed to
  the product's prefill policy (`proposeFields`) and renderer (`renderFormPdf`) of
  `packages/brain` through a bun bridge; no value is chosen by a language model. The same
  bridge reproduces the product's E7 gold exactly ({parity}).
- **Field gold** (`fields`, JSON): field id, label, type, owner section, page, boxes, validation,
  required flag, signature flag, fact type and mapping kind (`catalog`, `candidate` for the
  dataset's conservative E13 mapping of the applicant's identity fields, `unmapped`), status
  (`filled`, `missing:<reason>`, `provider_<owner>`, `signature`), value and provenance.
  Doctor, hospital and office sections and signatures are never filled; IBANs only from the
  person's own statement.
- **Detection gold**: boxes, labels, types and owners for the flattened filled PDF
  (`detection_flat`) and for simulated scans (`detection_scan`: rotated, noisy, JPEG-compressed
  image PDFs; boxes transformed accordingly).
- **PDFs**: `pdf_filled` (product output, AcroForm), `pdf_flat`, `pdf_scan` — included only for
  forms whose publisher permits reuse with attribution (SVS: "Die Inhalte der SVS-Website dürfen
  im hier genannten Rahmen bis auf Widerruf weiterverwendet werden, um Quellenangabe wird
  jedoch ersucht"). SV-Box forms (ÖGK, PVA, FSW, AUVA) ship field gold only.
- **Splits** follow the persona splits (train, val, test, heldout_family).

Counts: {instances} instances, {pdf_rows} with PDFs, {det} detection records. All persons are
synthetic; numbers carry valid check digits but belong to nobody. Source attribution per row.
"""
