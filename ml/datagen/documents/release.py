# ruff: noqa: E501
"""Release step: `uv run python -m datagen.documents.release` (from ml/).

Reads every shard under `<output_root>/documents/release/`, re-runs the deterministic rule checks
on the stored gold (quote = page text slice, no gold inside a clinical exclusion, blocklisted
names absent), runs MinHash near-duplicate detection over the model-written text, and writes
`release/metrics.json`, `ml/results/datagen-documents-<sha>.json` and `release/card.md`.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq

from .. import io as dio
from ..quality import NearDup, readability, wilson
from .judge import RUBRIC
from .names import BLOCKLIST

FAMILY = "documents"
COLUMNS = [
    "id",
    "split",
    "doc_type",
    "register",
    "n_pages",
    "text",
    "pages",
    "statements",
    "exclusions",
    "sentences",
    "scanned",
    "ocr",
    "judge",
    "prompt_tokens",
    "completion_tokens",
    "attempts",
]


def load(release: Path) -> list[dict]:
    rows = []
    for f in sorted(release.glob("*/*.parquet")):
        rows.extend(pq.read_table(f, columns=COLUMNS).to_pylist())
    return rows


def checks(row: dict) -> list[str]:
    problems = []
    pages = json.loads(row["pages"])
    statements = json.loads(row["statements"])
    exclusions = json.loads(row["exclusions"])
    for s in statements:
        text = pages[s["page"] - 1]["text"]
        if text[s["position"]["start"] : s["position"]["end"]] != s["quote"]:
            problems.append("quote_offset")
        for x in exclusions:
            if (
                x["page"] == s["page"]
                and s["type"] != "documented_recommendation"
                and s["position"]["start"] < x["position"]["end"]
                and x["position"]["start"] < s["position"]["end"]
            ):
                problems.append("gold_in_clinical")
    for name in BLOCKLIST:
        if re.search(rf"\b{re.escape(name)}\b", row["text"]):
            problems.append("blocklisted_name")
    return problems


def _ledger_usage() -> dict:
    """Actual tokens of the documents family from the shared ledger (generation + judge +
    rejected and retried calls)."""
    try:
        from ..ledger import Ledger

        rows = [r for r in Ledger().summary()["rows"] if r["family"] == FAMILY]
    except Exception as e:  # noqa: BLE001 - metrics must not fail on ledger access
        return {"error": str(e)}
    out: dict = {}
    for r in rows:
        m = out.setdefault(r["model"], {"requests": 0, "input_tokens": 0, "output_tokens": 0})
        m["requests"] += r["requests"] or 0
        m["input_tokens"] += r["input_tokens"] or 0
        m["output_tokens"] += r["output_tokens"] or 0
    return out


def metrics(rows: list[dict], run_stats: list[dict]) -> dict:
    by_split = Counter(r["split"] for r in rows)
    by_type = Counter(r["doc_type"] for r in rows)
    by_register = Counter(r["register"] for r in rows)
    fact_types: Counter = Counter()
    stmt_types: Counter = Counter()
    n_statements = 0
    rule_fail = Counter()
    dedup = NearDup(threshold=0.85)
    dups = 0
    ocr_recall, ocr_conf, scanned = [], [], 0
    wiener = {"standard": [], "plain": []}
    judge_scores: dict[str, list[int]] = {c["id"]: [] for c in RUBRIC["criteria"]}
    for r in rows:
        st = json.loads(r["statements"])
        n_statements += len(st)
        for s in st:
            fact_types[s["fact_type"]] += 1
            stmt_types[s["type"]] += 1
        for p in checks(r):
            rule_fail[p] += 1
        if r["doc_type"] != "prescription":
            text = " ".join(s["text"] for s in json.loads(r["sentences"]))
            if dedup.add(r["id"], text):
                dups += 1
            if r["doc_type"] in {"decision", "document_request", "reminder"}:
                rd = readability(text, "de").get("wiener_sachtextformel")
                if rd is not None:
                    wiener[r["register"]].append(rd)
        if r["scanned"]:
            scanned += 1
            o = json.loads(r["ocr"])
            if o.get("quote_recall") is not None:
                ocr_recall.append(o["quote_recall"])
            ocr_conf.extend(
                p["mean_conf"] for p in o.get("pages", []) if p.get("mean_conf") is not None
            )
        if r["judge"]:
            j = json.loads(r["judge"])
            for k, v in (j.get("scores") or {}).items():
                if k in judge_scores:
                    judge_scores[k].append(v)
    # judged = released judged documents + rejected ones (rejected.jsonl); exact across runs
    passed = sum(1 for r in rows if r["judge"])
    rejected_path = dio.family_dir(FAMILY) / "rejected.jsonl"
    rejected = len(rejected_path.read_text().splitlines()) if rejected_path.exists() else 0
    judged = passed + rejected
    lo, hi = wilson(passed, judged)
    mean = lambda xs: round(sum(xs) / len(xs), 3) if xs else None  # noqa: E731
    return {
        "family": FAMILY,
        "documents": len(rows),
        "by_split": dict(by_split),
        "by_doc_type": dict(by_type),
        "by_register": dict(by_register),
        "pages": sum(r["n_pages"] for r in rows),
        "statements": n_statements,
        "statements_by_type": dict(stmt_types),
        "statements_by_fact_type": dict(fact_types.most_common()),
        "rule_checks": {
            "documents_checked": len(rows),
            "failures": dict(rule_fail),
            "note": "Every released document also passed render-time verification against the PDF text layer (pdfium): quotes verbatim, offsets, words, boxes inside the page.",
        },
        "near_duplicates": {"threshold": 0.85, "count": dups},
        "judge": {
            "rubric": [c["id"] for c in RUBRIC["criteria"]],
            "judged": judged,
            "passed": passed,
            "pass_rate": round(passed / judged, 4) if judged else None,
            "pass_rate_wilson95": [round(lo, 4), round(hi, 4)],
            "released_mean_scores": {k: mean(v) for k, v in judge_scores.items()},
            "policy": "Every model-written document is judged; only passing documents are released.",
        },
        "scans": {
            "scanned_documents": scanned,
            "ocr_quote_recall_mean": mean(ocr_recall),
            "ocr_mean_confidence": mean(ocr_conf),
        },
        "readability_wiener_sachtextformel": {k: mean(v) for k, v in wiener.items()},
        "tokens": {
            "prompt": sum(r["prompt_tokens"] for r in rows),
            "completion": sum(r["completion_tokens"] for r in rows),
            "ledger_documents_family": _ledger_usage(),
        },
        "generation_runs": run_stats[-20:],
        "disk_gb": round(
            sum(f.stat().st_size for f in dio.release_dir(FAMILY).rglob("*.parquet")) / 1e9, 3
        ),
    }


def card(m: dict) -> str:
    rows = "\n".join(f"| `{k}` | {v} |" for k, v in sorted(m["by_doc_type"].items()))
    splits = ", ".join(f"{k} {v}" for k, v in sorted(m["by_split"].items()))
    facts = ", ".join(f"`{k}` {v}" for k, v in list(m["statements_by_fact_type"].items())[:16])
    j = m["judge"]
    return f"""## Config `documents`

Synthetic German (Austrian) documents a person brings to an advisor: hospital discharge letters
(Entlassungsbriefe), decisions (Bescheide) with appeal instructions, requests for documents,
reminders, private-practice invoices (Wahlarzt/Wahltherapeut Honorarnoten) and prescriptions.
Each document is a real PDF (A4, standard fonts) with exact gold for **documented-statement
extraction** (typed verbatim quotes with page, text offsets and bounding boxes) and plain-words
**letter explanation** targets; about a third also come as degraded 150 DPI scans with OCR.

**{m["documents"]} documents** ({splits}), {m["pages"]} pages, {m["statements"]} gold statements.

| Document type | Count |
| --- | ---: |
{rows}

### How it is made

* **Spec first.** For each AT-Benefits persona (config `personas`; the split is the persona's
  split, so `heldout_family` documents concern held-out care benefits only) a seeded spec fixes
  every administrative fact: issuing office from the engine gold (`office.resolve`) with its
  catalog address, benefit, dates, case numbers, care level, amounts, deadlines, requested
  documents (catalog `documents` not held by the persona), medicine names, and the documented
  recommendations (benefits from the persona's gold, e.g. rehabilitation, care allowance, aids).
* **Model writes prose only.** `gpt-6-luna` writes the sections as JSON sentences with a role
  (clinical, recommendation, open task, administrative, other). Deterministic validation rejects
  output with dates or amounts not in the spec, medicine names in prose, recommendations that carry
  a medical rationale or are missing, or real public figures; rejected output is retried with the
  error list. Prescriptions are template-only.
* **Renderer owns the gold.** A deterministic reportlab layout (letterheads, address window,
  reference block, tables, footers, page breaks) draws every text item at a known position. Gold
  quotes, page-local `[start, end)` offsets and boxes come from the renderer, and every document is
  verified against the PDF text layer extracted with pdfium before release.
* **Judge filter.** `gpt-6-sol` scores every model-written document on {", ".join(j["rubric"])}
  (1-5); only documents with all scores >= 4 are released. Pass rate so far:
  {j["passed"]}/{j["judged"]} ({j["pass_rate"]}; Wilson 95 % {j["pass_rate_wilson95"]}).
* **Near-duplicates** of model-written text (MinHash, char 5-grams, Jaccard 0.85) are dropped.

### Gold format (E12-compatible)

`statements` (JSON list): `id`, `type` (`documented_recommendation` | `administrative_fact`),
`fact_type`, `quote` (verbatim page-text slice; line breaks inside a quote are `\\n`), `page`
(1-based), `position` `{{start, end}}` (page-local, Unicode code points = UTF-16 units here), `bbox`
`{{x, y, width, height}}` normalised to the page with a top-left origin, per-line `boxes`, and
provenance (`source`: spec, catalog or model). Fact types: {facts}.
`pages` follows the SV KI-Lotse brain's `documentPageSchema` (text = lines joined by newlines;
rows are items within 5 pt of a baseline, left to right, like the E12 pdfjs serialization).
`exclusions` lists clinical sentences (diagnoses, findings, course) for negative overlap checks:
**diagnoses and findings are never gold facts** (PRD FR-D3 and the medical boundary).
`explanation` holds FR-D8 targets computed from the spec, not by a model: what is asked (with
catalog document ids), by when (absolute date or relative appeal period) and what happens next,
plus a plain-language summary; for discharge letters the navigation targets (benefit and
responsible office per documented recommendation).

Other columns: `pdf` (bytes), `scan_pages` (PNG bytes per page, grayscale 150 DPI), `scan_meta`
(rotation, blur, noise, JPEG quality and the rotated gold boxes), `ocr` (Tesseract `deu` text per
page, mean confidence, gold-quote recall), `spec`, `sentences` (model sentences with roles),
`judge`, persona and benefit ids, token usage.

### Limitations

* Synthetic. Hospitals, practices, rehabilitation centres and all persons are invented; carrier
  and authority letters name the real responsible office from the catalog but are not issued by
  it (footer on every page) and use no logos. Insurance numbers have a deliberately wrong check
  digit.
* Medical content is fictional and was not reviewed by clinicians; it is a distractor for
  extraction, not medical information. Appeal periods and courts follow Austrian practice as
  modelled for this dataset and are not legal advice.
* Layouts are generated, so real-world scan artefacts (stamps, handwriting, folds) are missing.
* Reproduce: `uv run python -m datagen.documents.run --tranche 1` then
  `uv run python -m datagen.documents.release` (from `ml/`).
"""


def backfill_ocr(release: Path) -> int:
    """Re-run OCR for scanned rows whose OCR is empty (shards written before the tsv fix)."""
    from .scan import ocr, quote_recall

    fixed = 0
    for f in sorted(release.glob("*/*.parquet")):
        table = pq.read_table(f)
        rows = table.to_pylist()
        changed = False
        for r in rows:
            if not r["scanned"]:
                continue
            o = json.loads(r["ocr"])
            if o.get("available") and any(p.get("words") for p in o.get("pages", [])):
                continue
            o = ocr(r["scan_pages"])
            o["quote_recall"] = quote_recall(json.loads(r["statements"]), o)
            r["ocr"] = json.dumps(o, ensure_ascii=False)
            changed = True
            fixed += 1
        if changed:
            dio.write_shard(rows, f, schema=table.schema)
    return fixed


def main() -> int:
    release = dio.release_dir(FAMILY)
    if "--backfill-ocr" in sys.argv:
        print(f"ocr backfilled: {backfill_ocr(release)}")
    rows = load(release)
    stats_path = dio.family_dir(FAMILY) / "run_stats.jsonl"
    run_stats = (
        [json.loads(line) for line in stats_path.read_text().splitlines()]
        if stats_path.exists()
        else []
    )
    for s in run_stats:
        s.pop("args", None)
    m = metrics(rows, run_stats)
    dio.write_card(FAMILY, card(m))
    a, b = dio.write_metrics(FAMILY, m)
    print(
        json.dumps(
            {k: m[k] for k in ("documents", "by_split", "by_doc_type", "statements")},
            ensure_ascii=False,
        )
    )
    print(
        f"judge {m['judge']['passed']}/{m['judge']['judged']}; rule failures {m['rule_checks']['failures']}; dups {m['near_duplicates']['count']}"
    )
    print(a, b)
    return 0


if __name__ == "__main__":
    sys.exit(main())
