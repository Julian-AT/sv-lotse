# ruff: noqa: E501
"""Gold per document: E12-compatible statements, exclusions, brain page schema, FR-D8 targets.

Everything here is computed from the spec and the renderer, never by a model:

* `statements`: typed quotes (`documented_recommendation` | `administrative_fact`) with
  `fact_type`, verbatim `quote` from the page text, one-based `page`, page-local `position`
  `[start, end)` in the page text (Python str indices = Unicode code points; the letters are
  cp1252, so they equal JavaScript UTF-16 offsets), union `bbox` and per-line `boxes`.
* `exclusions`: clinical sentences (diagnoses, findings, course) for negative overlap checks;
  they are never facts (FR-D3).
* `explanation`: plain-words targets for letters (FR-D8): what is asked, by when, what next.
"""

from __future__ import annotations

from typing import Any

from . import catalog
from .layout import Engine, resolve
from .spec import DocSpec


def pages_schema(engine: Engine) -> list[dict[str, Any]]:
    """Pages in the brain's `documentPageSchema` shape (text = lines joined by newline)."""
    return [
        {
            "page": p.number,
            "width": 595.2756,
            "height": 841.8898,
            "text": p.text,
            "lines": p.lines,
            "method": "text_layer",
        }
        for p in engine.pages
    ]


def statements(engine: Engine) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[str]]:
    gold, excl, errors = [], [], []
    for rec in resolve(engine):
        if "error" in rec:
            errors.append(f"{rec['id']}:{rec['error']}")
            continue
        if rec.pop("kind") == "exclusion":
            excl.append(rec)
        else:
            gold.append(rec)
    gold.sort(key=lambda r: (r["page"], r["position"]["start"], -r["position"]["end"]))
    excl.sort(key=lambda r: (r["page"], r["position"]["start"]))
    return gold, excl, errors


def _office_name(office_id: Any) -> str | None:
    if not isinstance(office_id, str):
        return None
    office = catalog.offices().get(office_id)
    return office.name_de if office else None


def explanation(spec: DocSpec) -> dict[str, Any]:
    t = spec.doc_type
    out: dict[str, Any] = {
        "doc_type": t,
        "benefit": spec.benefit_id,
        "benefit_name": spec.benefit_name,
        "issuer": spec.issuer.name,
        "office": spec.issuer.office_id,
        "asked": [],
        "by_when": None,
        "next": [],
        "plain": "",
    }
    if t in {"document_request", "reminder"}:
        names = [d["name"] for d in spec.requested_documents]
        out["asked"] = [
            {
                "action": "submit_document",
                "document": d["id"],
                "name": d["name"],
                "obtain_from": d["obtain_from"] or None,
            }
            for d in spec.requested_documents
        ]
        out["by_when"] = {
            "date": spec.deadline["iso"],
            "text": spec.deadline["date"],
            "relative": False,
        }
        out["next"] = [
            "Nach Eingang der Unterlagen wird der Antrag weiter bearbeitet.",
            "Fehlen die Unterlagen nach der Frist, wird nach der vorliegenden Aktenlage entschieden.",
        ]
        verb = (
            "Das Amt erinnert Sie: Es fehlen noch Unterlagen."
            if t == "reminder"
            else "Das Amt braucht noch Unterlagen für Ihren Antrag."
        )
        out["plain"] = (
            f"{verb} Bitte schicken Sie bis {spec.deadline['date']}: {'; '.join(names)}. "
            "Danach wird Ihr Antrag weiter bearbeitet. Ohne die Unterlagen wird nur mit dem entschieden, was schon da ist."
        )
    elif t == "decision":
        ap = spec.appeal or {}
        outcome = spec.outcome or "approved"
        out["outcome"] = outcome
        if spec.care_level:
            out["care_level"] = spec.care_level
        if spec.amount_cents is not None:
            out["amount"] = spec.facts_value("amount")
        out["asked"] = [
            {"action": "none", "name": "Keine Handlung nötig, wenn Sie einverstanden sind."}
        ] + [{"action": "optional_appeal", "name": ap.get("route")}]
        out["by_when"] = {
            "date": None,
            "text": f"binnen {ap.get('period')} ab Zustellung",
            "relative": True,
            "days": ap.get("days"),
        }
        what = {
            "approved": "Ihr Antrag wurde bewilligt.",
            "partial": "Ihr Antrag wurde teilweise bewilligt.",
            "rejected": "Ihr Antrag wurde abgelehnt.",
        }[outcome]
        detail = ""
        if spec.care_level:
            detail = f" Sie bekommen Pflegegeld der Stufe {spec.care_level}."
        elif spec.reha_centre:
            detail = f" Der Aufenthalt ist in {spec.reha_centre} ab {spec.treatment_dates[0]} vorgesehen."
        elif spec.amount_cents is not None and outcome != "rejected":
            detail = f" Der Betrag ist {spec.facts_value('amount')}."
        out["next"] = (
            ["Die Leistung wird so gewährt, wie es im Bescheid steht."]
            if outcome != "rejected"
            else []
        ) + [
            f"Wer nicht einverstanden ist: {ap.get('route')} binnen {ap.get('period')} ab Zustellung."
        ]
        out["plain"] = (
            f"{what}{detail} Sie müssen nichts tun, wenn Sie einverstanden sind. "
            f"Wenn nicht, haben Sie {ap.get('period_nom')} ab Erhalt des Briefes Zeit für eine {ap.get('route')}."
        )
    elif t == "wahlarzt_invoice":
        out["asked"] = [
            {
                "action": "submit_for_reimbursement",
                "name": "Honorarnote mit Zahlungsnachweis beim Krankenversicherungsträger einreichen",
            }
        ]
        out["next"] = [
            "Der Krankenversicherungsträger prüft die Kostenerstattung nach seinem Tarif."
        ]
        out["amount"] = spec.facts_value("amount")
        out["plain"] = (
            f"Das ist eine Rechnung über {spec.facts_value('amount')}. Wenn Sie bezahlt haben, können Sie die Rechnung "
            "mit dem Zahlungsnachweis bei Ihrer Krankenkasse einreichen. Die Kasse erstattet einen Teil nach ihrem Tarif."
        )
    elif t == "discharge_letter":
        out["navigation"] = [
            {
                "recommendation": r["kind"],
                "benefit": r["benefit"],
                "benefit_name": (
                    catalog.benefits().get(r["benefit"]).name_de
                    if catalog.benefits().get(r["benefit"])
                    else None
                ),
                "office": r["office"] if isinstance(r["office"], str) else None,
                "office_name": _office_name(r["office"]),
            }
            for r in spec.recommendations
        ]
        out["by_when"] = (
            {
                "date": None,
                "text": spec.follow_up["date"],
                "relative": False,
                "kind": "follow_up_appointment",
            }
            if spec.follow_up
            else None
        )
        out["plain"] = (
            "Im Entlassungsbrief wird empfohlen: "
            + "; ".join(r["hint"] for r in spec.recommendations)
            + (f". Kontrolltermin: {spec.follow_up['date']}." if spec.follow_up else ".")
        )
    elif t == "prescription":
        out["asked"] = [
            {
                "action": "redeem_prescription",
                "name": "Rezept in der Apotheke oder beim Fachhandel einlösen",
            }
        ]
        out["plain"] = (
            "Das ist ein Rezept bzw. eine Verordnung. Sie lösen es in der Apotheke oder beim Fachhandel ein."
        )
    return out
