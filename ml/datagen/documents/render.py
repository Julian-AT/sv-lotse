"""Render a spec + content to PDF and gold, and verify the gold against the PDF text layer."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import pypdfium2 as pdfium

from . import gold as gold_mod
from .compose import Composer
from .content import Section
from .spec import DocSpec

TITLES = {
    "discharge_letter": "Entlassungsbrief",
    "decision": "Bescheid",
    "document_request": "Aufforderung zur Vorlage von Unterlagen",
    "reminder": "Erinnerung",
    "wahlarzt_invoice": "Honorarnote",
    "prescription": "Rezept",
}


@dataclass
class Rendered:
    pdf: bytes
    pages: list[dict[str, Any]]
    statements: list[dict[str, Any]]
    exclusions: list[dict[str, Any]]
    explanation: dict[str, Any]
    errors: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\f".join(p["text"] for p in self.pages)


def render(spec: DocSpec, sections: list[Section]) -> Rendered:
    engine = Composer(spec, sections).build()
    statements, exclusions, errors = gold_mod.statements(engine)
    pdf = _draw(engine, spec)
    return Rendered(
        pdf=pdf,
        pages=gold_mod.pages_schema(engine),
        statements=statements,
        exclusions=exclusions,
        explanation=gold_mod.explanation(spec),
        errors=errors,
    )


def _draw(engine, spec: DocSpec) -> bytes:
    from .layout import draw_pdf

    return draw_pdf(engine, f"{TITLES[spec.doc_type]} (synthetisch) {spec.doc_id}")


_WS = re.compile(r"\s+")


def _norm(text: str) -> str:
    return _WS.sub(" ", text).strip()


def pdf_text_pages(pdf: bytes) -> list[str]:
    doc = pdfium.PdfDocument(pdf)
    try:
        out = []
        for i in range(len(doc)):
            page = doc[i]
            tp = page.get_textpage()
            out.append(tp.get_text_range())
            tp.close()
            page.close()
        return out
    finally:
        doc.close()


def verify(rendered: Rendered) -> list[str]:
    """Rule checks against the actual PDF: page count, quotes verbatim in the extracted text,
    page text equal to the extracted words, boxes inside the page, gold not overlapping clinical
    exclusions."""
    problems: list[str] = []
    extracted = pdf_text_pages(rendered.pdf)
    if len(extracted) != len(rendered.pages):
        return [f"page_count {len(extracted)} != {len(rendered.pages)}"]
    # pdfium marks a line-final hyphen as U+FFFE and joins the lines; undo that for comparison
    norm_pages = [_norm(t.replace("\ufffe", "- ").replace("\ufffd", "")) for t in extracted]
    for page, ext in zip(rendered.pages, norm_pages, strict=True):
        if sorted(_norm(page["text"]).split()) != sorted(ext.split()):
            problems.append(f"page {page['page']}: text layer words differ from extraction")
    for s in rendered.statements:
        page = rendered.pages[s["page"] - 1]
        if page["text"][s["position"]["start"] : s["position"]["end"]] != s["quote"]:
            problems.append(f"{s['id']}: offsets do not address the quote")
        if _norm(s["quote"]) not in norm_pages[s["page"] - 1]:
            problems.append(f"{s['id']}: quote not found verbatim in PDF text layer")
        b = s["bbox"]
        if not (
            b["x"] >= 0
            and b["y"] >= 0
            and b["x"] + b["width"] <= 1.000001
            and b["y"] + b["height"] <= 1.000001
        ):
            problems.append(f"{s['id']}: bbox outside page")
        for x in rendered.exclusions:
            if x["page"] == s["page"] and s["fact_type"] != "documented_recommendation":
                a, bnd = s["position"]["start"], s["position"]["end"]
                if a < x["position"]["end"] and x["position"]["start"] < bnd:
                    problems.append(f"{s['id']}: overlaps clinical exclusion {x['id']}")
    return problems
