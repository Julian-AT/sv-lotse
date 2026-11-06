# ruff: noqa: E501
"""Model rounds (submit, validate, retry with errors) and dataset rows (render, verify, scan, OCR)."""

from __future__ import annotations

import datetime as dt
import json
import random
from dataclasses import dataclass, field
from typing import Any

from . import content as C
from . import scan as S
from .render import render, verify
from .spec import DocSpec

GENERATOR_VERSION = "documents-v1"
MAX_ATTEMPTS = 3
MAX_OUTPUT = {
    "discharge_letter": 6000,
    "decision": 3000,
    "document_request": 2000,
    "reminder": 2000,
    "wahlarzt_invoice": 1200,
}


@dataclass
class Outcome:
    spec: DocSpec
    sections: list[C.Section] | None = None
    raw: Any = None
    attempts: int = 0
    errors: list[str] = field(default_factory=list)
    usage: dict[str, int] = field(
        default_factory=lambda: {"prompt_tokens": 0, "completion_tokens": 0}
    )
    model: str | None = None
    budget_stop: bool = False


def _request(o: Outcome) -> dict[str, Any]:
    return {
        "custom_id": o.spec.doc_id,
        "messages": C.build_messages(o.spec, o.errors or None),
        "response_format": C.RESPONSE_FORMAT,
        "max_output_tokens": MAX_OUTPUT[o.spec.doc_type],
    }


def run_model_rounds(specs: list[DocSpec], llm, log=print) -> list[Outcome]:
    """Submit all LLM documents together, validate, resubmit the invalid ones with their errors."""
    outcomes = [Outcome(s) for s in specs]
    pending = [o for o in outcomes if o.spec.doc_type in C.SECTION_KEYS]
    for o in outcomes:
        if o.spec.doc_type not in C.SECTION_KEYS:
            o.sections = []
    for attempt in range(1, MAX_ATTEMPTS + 1):
        if not pending:
            break
        bid = llm.submit_batch([_request(o) for o in pending], role="bulk")
        results = {r.custom_id: r for r in llm.collect_batch(bid, wait=True)}
        retry = []
        for o in pending:
            o.attempts = attempt
            r = results.get(o.spec.doc_id)
            if r is None:
                o.errors = ["no result"]
                retry.append(o)
                continue
            u = r.usage or {}
            o.usage["prompt_tokens"] += int(u.get("prompt_tokens") or 0)
            o.usage["completion_tokens"] += int(u.get("completion_tokens") or 0)
            o.model = r.model or o.model
            if r.error:
                if r.error in {"budget_exceeded", "stopped"}:
                    o.budget_stop = True
                    o.errors = [r.error]
                    continue
                o.errors = [f"model error: {r.error}"]
                retry.append(o)
                continue
            try:
                sections = C.parse(r.parsed if isinstance(r.parsed, dict) else r.text)
            except (json.JSONDecodeError, TypeError, AttributeError) as e:
                o.errors = [f"invalid JSON: {e}"]
                retry.append(o)
                continue
            errors = C.validate(o.spec, sections)
            if errors:
                o.errors = errors
                retry.append(o)
                continue
            o.sections, o.raw, o.errors = (
                sections,
                r.parsed if isinstance(r.parsed, dict) else json.loads(r.text),
                [],
            )
        log(f"round {attempt}: {len(pending) - len(retry)} ok, {len(retry)} to retry")
        pending = retry
    return outcomes


def build_row(o: Outcome, scan_share: float = 0.35) -> tuple[dict[str, Any] | None, list[str]]:
    spec = o.spec
    rendered = render(spec, o.sections or [])
    problems = rendered.errors + verify(rendered)
    if problems:
        return None, problems
    statements = rendered.statements
    rng = random.Random(int(spec.doc_id.split("-")[-1], 16))
    scanned = rng.random() < scan_share
    scan_pages: list[bytes] = []
    scan_meta: dict[str, Any] | None = None
    ocr_res: dict[str, Any] = {"available": False, "pages": []}
    if scanned:
        p = S.params(rng.randint(0, 2**31))
        scan_pages = S.simulate(rendered.pdf, p)
        size = S.png_size(scan_pages[0])
        scan_meta = {**p, "size": list(size), "bbox": S.map_boxes(statements, p, size)}
        ocr_res = S.ocr(scan_pages)
        ocr_res["quote_recall"] = S.quote_recall(statements, ocr_res)
    sentences = [
        {"section": sec.key, "heading": sec.heading, "text": s.text, "role": s.role, "rec": s.rec}
        for sec in (o.sections or [])
        for s in sec.sentences
    ]
    counts: dict[str, int] = {}
    for s in statements:
        counts[s["fact_type"]] = counts.get(s["fact_type"], 0) + 1
    row = {
        "id": spec.doc_id,
        "split": spec.split,
        "doc_type": spec.doc_type,
        "register": spec.register,
        "language": "de-easy" if spec.register == "plain" else "de",
        "persona_id": spec.persona_id,
        "scenario": spec.scenario,
        "goal": spec.goal,
        "life_situation": spec.life_situation,
        "benefit_id": spec.benefit_id,
        "issuer": spec.issuer.name,
        "issuer_kind": spec.issuer.kind,
        "issuer_fictional": spec.issuer.fictional,
        "office_id": spec.issuer.office_id,
        "carrier": spec.carrier,
        "n_pages": len(rendered.pages),
        "text": rendered.text,
        "pages": json.dumps(rendered.pages, ensure_ascii=False),
        "statements": json.dumps(statements, ensure_ascii=False),
        "n_statements": len(statements),
        "n_recommendations": sum(1 for s in statements if s["type"] == "documented_recommendation"),
        "fact_type_counts": json.dumps(counts, sort_keys=True),
        "exclusions": json.dumps(rendered.exclusions, ensure_ascii=False),
        "explanation": json.dumps(rendered.explanation, ensure_ascii=False),
        "spec": spec.to_json(),
        "sentences": json.dumps(sentences, ensure_ascii=False),
        "pdf": rendered.pdf,
        "scanned": scanned,
        "scan_pages": scan_pages,
        "scan_meta": json.dumps(scan_meta) if scan_meta else None,
        "ocr": json.dumps(ocr_res, ensure_ascii=False),
        "model": o.model if o.sections else None,
        "prompt_tokens": o.usage["prompt_tokens"],
        "completion_tokens": o.usage["completion_tokens"],
        "attempts": o.attempts,
        "generator": GENERATOR_VERSION,
        "created_at": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
    }
    return row, []
