# ruff: noqa: E501
"""What the language model writes: sections of sentences with a role per sentence.

The model receives the spec's facts as verbatim strings and writes prose only. Its output is
validated deterministically (`validate`): every documented recommendation from the spec appears
exactly once in its own sentence without a medical rationale, no dates or amounts other than the
spec's appear, no medicine names occur in prose, no real public figure is named. Invalid output is
retried with the error list; it never reaches the dataset.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from .names import BLOCKLIST
from .spec import ALL_MEDICINE_NAMES, DocSpec

ROLES = ("clinical", "recommendation", "open_task", "administrative", "other")

SECTION_KEYS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    # doc type: (required keys in order, optional keys)
    "discharge_letter": (
        ("diagnoses", "reason", "course", "status", "recommendations"),
        ("social",),
    ),
    "decision": (("ruling", "reasons"), ("notes",)),
    "document_request": (("intro", "explanation", "closing"), ()),
    "reminder": (("intro", "explanation", "closing"), ()),
    "wahlarzt_invoice": (("diagnosis",), ("note",)),
}

CONTENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["sections"],
    "properties": {
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["key", "heading", "style", "sentences"],
                "properties": {
                    "key": {"type": "string"},
                    "heading": {"type": ["string", "null"]},
                    "style": {"type": "string", "enum": ["prose", "bullets"]},
                    "sentences": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["text", "role", "rec"],
                            "properties": {
                                "text": {"type": "string"},
                                "role": {"type": "string", "enum": list(ROLES)},
                                "rec": {"type": ["string", "null"]},
                            },
                        },
                    },
                },
            },
        }
    },
}
RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {"name": "document_content", "strict": True, "schema": CONTENT_SCHEMA},
}

SYSTEM = """You write realistic German (Austrian standard German) administrative and medical \
documents for a synthetic research dataset. Everything is fictional. You output JSON only.

Hard rules:
- Use administrative facts (names, dates, numbers, amounts, institutions) ONLY as given in the \
spec, copied character for character. Never invent other dates, amounts, case numbers, phone \
numbers, persons or institutions. Do not repeat the letterhead, address block or signature; the \
layout adds them.
- Do not name any medicine or active substance in your sentences (the medication list is added \
by the layout).
- Each sentence is one array item. Its `role`: `clinical` (diagnoses, findings, course, symptoms, \
assessments, therapy details), `recommendation` (an explicitly documented navigation \
recommendation from the spec; set `rec` to its id), `open_task` (a concrete administrative task \
for the patient or relatives, e.g. who fills in or sends which form), `administrative` (other \
administrative statements), `other` (courtesy, context). `rec` is null unless role is \
recommendation.
- In discharge letters, no other sentence may contain "empfehlen"/"empfohlen"; aftercare \
instructions (wound care, controls) are written as instructions with role clinical or open_task.
- Phrase each recommendation in your own words, specific to the case (do not copy the spec's \
"what" text), e.g. "Wir empfehlen die Einleitung eines Anschlussheilverfahrens in einer \
orthopädischen Rehabilitationseinrichtung."
- Write each spec recommendation exactly once, as its own sentence, stating plainly what is \
recommended ("Eine ... wird empfohlen.", "Wir empfehlen ..."). The recommendation sentence \
contains NO medical reason (no "aufgrund", "wegen", "infolge", "da", "bei"+diagnosis); put any \
medical reason into a separate clinical sentence.
- Never assess risk or prognosis for the reader, never suggest therapies or medicines beyond \
what the spec documents.
- Do not write a salutation, the closing formula ("Mit freundlichen Grüßen") or a signature; the \
layout adds them. Do not reference attachments, portals or addresses that are not in the spec \
except the generic ways named in the brief.
- Write like a real Austrian office or hospital: concrete, specific, no filler, no placeholders.
"""

TYPE_BRIEF = {
    "discharge_letter": """Document: hospital discharge letter (Entlassungsbrief) to the general \
practitioner, copy to the patient. Sections in this order with German headings you choose: \
`diagnoses` (style bullets, 2-5 clinical diagnosis lines related to the clinical theme), `reason` \
(Aufnahmegrund/Anamnese, 2-4 sentences), `course` (stationärer Verlauf, 4-8 sentences, clinical), \
`status` (Status bei Entlassung, 2-5 sentences, clinical), optional `social` (Sozialanamnese / \
häusliche Situation, 1-3 sentences, role other), `recommendations` (Empfehlungen und weiteres \
Procedere: every spec recommendation once, plus 1-4 open_task or administrative sentences, e.g. \
who fills in which application, that the medication plan is to be shown to the GP). Medical \
content is fictional but clinically plausible for the theme, the department and the patient's \
age, and the status at discharge must make every documented recommendation plausible (e.g. a \
walking aid only with reduced mobility, a care allowance only with an ongoing need for help).""",
    "decision": """Document: official decision letter (Bescheid) of the issuing office about the \
benefit in the spec. Sections: `ruling` (Spruch: 1-3 sentences stating the outcome exactly as \
the spec says, using the given care level / amount with its basis (monthly, daily, one-off) / \
facility / dates / approved item verbatim; for a partial approval state exactly what is granted \
and what is not), `reasons` (Begründung: \
3-8 sentences on the administrative basis: application received, documents and assessment \
considered, the spec's legal_basis named; for a rejection or partial approval the spec's \
reason stated concretely and explained in 1-2 administrative sentences; no medical details), optional `notes` (Hinweise: 1-4 sentences, e.g. duty to report changes, how payment \
happens). Do NOT write the appeal instructions (Rechtsmittelbelehrung): the layout adds them.""",
    "document_request": """Document: letter from the office requesting missing documents for a \
pending application (Aufforderung zur Vorlage von Unterlagen). Sections: `intro` (1-3 sentences: \
the application for the benefit was received, processing is ongoing), `explanation` (2-4 \
sentences: why documents are needed, without listing them; the layout adds the list, the \
deadline sentence and the consequence), `closing` (1-3 sentences: how to send them - \
by post to the address in the letterhead (only if issuer_has_postal_address), in person at the customer service, or electronically \
via the online service of the office - plus a contact offer). Do not state a deadline or the \
list of documents yourself.""",
    "reminder": """Document: reminder letter (Erinnerung) because documents requested in the \
earlier letter dated {previous} have not arrived. Sections: `intro` (1-3 sentences referring to \
the earlier letter of {previous}), `explanation` (1-3 sentences: the documents are still \
missing; the layout adds the list, the new deadline and the consequence), `closing` (1-3 \
sentences: how to send them - by post, in person or via the online service of the office - and \
if already sent, please disregard). Do not state a deadline \
or the list of documents yourself.""",
    "wahlarzt_invoice": """Document: invoice (Honorarnote) of a private practice (Wahlarzt / \
Wahltherapeut). Sections: `diagnosis` (style prose, exactly 1 clinical sentence beginning with \
"Diagnose:" or "Zuweisungsdiagnose:" naming a medical condition plausible for the specialty, \
never the treatment itself), optional `note` (1-2 sentences, role administrative, e.g. \
that the invoice can be submitted to the health insurer for reimbursement, or payment terms). \
The layout renders the service table, total and payment confirmation.""",
}

PLAIN = """Register: Einfache Sprache (level B1). Short sentences (max. 15 words), one idea per \
sentence, active voice, address the reader with "Sie", explain any technical term in a few words."""


def _facts_block(spec: DocSpec) -> dict[str, Any]:
    out: dict[str, Any] = {
        "letter_date": spec.letter_date,
        "issuer": spec.issuer.name,
        "issuer_has_postal_address": bool(spec.issuer.lines),
        "reference": f"{spec.reference_label} {spec.reference}",
        "patient": {
            "name": spec.patient.full,
            "sex": spec.patient.sex,
            "birth_date": spec.patient.birth_date,
        },
        "carrier": spec.carrier_name,
        "benefit": spec.benefit_name,
    }
    if spec.doc_type == "discharge_letter":
        out |= {
            "department": spec.issuer.lines[0],
            "admission_date": spec.admission_date,
            "discharge_date": spec.discharge_date,
            "clinical_theme": spec.clinical_theme,
            "care_level": spec.care_level,
            "follow_up_appointment": spec.follow_up,
            "recommendations": [{"id": r["id"], "what": r["hint"]} for r in spec.recommendations],
        }
    if spec.doc_type == "decision":
        outcome = {
            "approved": "approved in full",
            "rejected": "rejected",
            "partial": "approved in part",
        }[spec.outcome or "approved"]
        out |= {"outcome": outcome}
        if spec.care_level:
            out["care_level"] = f"Stufe {spec.care_level}"
        if spec.amount_cents is not None:
            out["amount"] = spec.facts_value("amount")
        if spec.outcome != "rejected":
            out["decision_kind"] = spec.decision_kind
        out["legal_basis"] = spec.legal_basis
        out["application_date"] = spec.application_date
        if spec.treatment_dates and spec.decision_kind in {"level", "amount"}:
            out["valid_from"] = spec.treatment_dates[0]
        if spec.decision_reason:
            out["reason_for_rejection_or_partial"] = spec.decision_reason
        if spec.amount_basis:
            out["amount_basis"] = spec.amount_basis
        if spec.decision_kind == "exemption" and spec.treatment_dates:
            out["exempt_from"], out["exempt_until"] = spec.treatment_dates
        if spec.aid:
            out["approved_item"] = spec.aid
        if spec.reha_centre:
            out["facility"] = spec.reha_centre
            out["stay"] = {"from": spec.treatment_dates[0], "until": spec.treatment_dates[1]}
    if spec.doc_type in {"document_request", "reminder"}:
        out["requested_documents_context"] = [d["name"] for d in spec.requested_documents]
        if spec.previous_letter_date:
            out["previous_letter_date"] = spec.previous_letter_date
    if spec.doc_type == "wahlarzt_invoice":
        out["services"] = [it["service"] for it in spec.invoice_items]
        out["practice_specialty"] = spec.issuer.lines[0]
    return out


def build_messages(spec: DocSpec, errors: list[str] | None = None) -> list[dict[str, str]]:
    brief = TYPE_BRIEF[spec.doc_type].format(previous=spec.previous_letter_date or "")
    user = [brief]
    if spec.register == "plain":
        user.append(PLAIN)
    user.append(
        "Spec (copy facts verbatim):\n"
        + json.dumps(_facts_block(spec), ensure_ascii=False, indent=1)
    )
    required, optional = SECTION_KEYS[spec.doc_type]
    user.append(f"Section keys: required {list(required)}, optional {list(optional)}.")
    if errors:
        user.append(
            "Your previous answer was rejected. Fix these problems:\n- " + "\n- ".join(errors[:12])
        )
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": "\n\n".join(user)}]


@dataclass
class Sentence:
    text: str
    role: str
    rec: str | None


@dataclass
class Section:
    key: str
    heading: str | None
    style: str
    sentences: list[Sentence]


# cp1252-safe normalisation (the PDF uses the standard 14 fonts)
_REPLACE = {
    "→": "->",
    "←": "<-",
    "≥": ">=",
    "≤": "<=",
    " ": " ",
    " ": " ",
    " ": " ",
    "‑": "-",
    "‒": "-",
    "−": "-",
    "’": "'",
    "′": "'",
    "­": "",
    "​": "",
    "•": "-",
    "×": "x",
}
_CAUSAL = re.compile(
    r"\b(aufgrund|auf Grund|wegen|infolge|bedingt durch|da (?:die|der|das|eine|ein|sie|er)|bei (?:Zustand|bekannter|bestehender|Diagnose))\b",
    re.I,
)
_DATE = re.compile(
    r"\b\d{1,2}\.\s?(?:\d{1,2}\.|(?:Jänner|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember))\s?\d{4}\b"
)
_EUR = re.compile(r"(?:EUR|€)\s?\d[\d.]*,\d{2}|\d[\d.]*,\d{2}\s?(?:EUR|€|Euro)")


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text)
    for a, b in _REPLACE.items():
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def encodable(text: str) -> bool:
    try:
        text.encode("cp1252")
    except UnicodeEncodeError:
        return False
    return True


def parse(raw: Any) -> list[Section]:
    data = json.loads(raw) if isinstance(raw, str) else raw
    sections = []
    for s in data.get("sections") or []:
        sents = [
            Sentence(
                clean_text(str(x.get("text") or "")),
                str(x.get("role") or "other"),
                x.get("rec") or None,
            )
            for x in s.get("sentences") or []
        ]
        sents = [x for x in sents if x.text]
        heading = clean_text(s["heading"]) if s.get("heading") else None
        sections.append(Section(str(s.get("key") or ""), heading, s.get("style") or "prose", sents))
    return sections


_MED_NAMES = sorted(
    {p for n in ALL_MEDICINE_NAMES for p in [n, *n.split("/")]}, key=len, reverse=True
)


def validate(spec: DocSpec, sections: list[Section]) -> list[str]:
    errors: list[str] = []
    required, optional = SECTION_KEYS[spec.doc_type]
    keys = [s.key for s in sections]
    for k in required:
        if keys.count(k) != 1:
            errors.append(f"section `{k}` must appear exactly once (found {keys.count(k)})")
    for k in keys:
        if k not in required and k not in optional:
            errors.append(f"unknown section key `{k}`")
    order = [k for k in keys if k in required]
    if order != [k for k in required if k in keys]:
        errors.append(f"sections must follow the order {list(required)}")
    rec_ids = {r["id"]: r for r in spec.recommendations}
    seen: dict[str, int] = {}
    allowed_dates = {
        v
        for v in [
            spec.letter_date,
            spec.admission_date,
            spec.discharge_date,
            spec.previous_letter_date,
            spec.patient.birth_date,
            spec.application_date,
            (spec.follow_up or {}).get("date"),
            (spec.deadline or {}).get("date"),
            *spec.treatment_dates,
        ]
        if v
    }
    allowed_amounts = {f["value"] for f in spec.facts if f["type"] == "amount"} | {
        it["amount"] for it in spec.invoice_items
    }
    total_chars = 0
    for sec in sections:
        if not sec.sentences:
            errors.append(f"section `{sec.key}` has no sentences")
        for s in sec.sentences:
            total_chars += len(s.text)
            if s.role not in ROLES:
                errors.append(f"invalid role `{s.role}`")
            if s.role == "recommendation":
                rec = rec_ids.get(s.rec or "")
                if rec is None:
                    errors.append(
                        f"recommendation sentence with unknown rec id `{s.rec}`: {s.text[:80]}"
                    )
                    continue
                seen[rec["id"]] = seen.get(rec["id"], 0) + 1
                if not any(k.lower() in s.text.lower() for k in rec["keywords"]):
                    errors.append(
                        f"recommendation {rec['id']} must name one of {rec['keywords']}: {s.text[:80]}"
                    )
                if _CAUSAL.search(s.text):
                    errors.append(
                        f"recommendation {rec['id']} contains a medical reason; split it: {s.text[:80]}"
                    )
                if (
                    "empfehl" not in s.text.lower()
                    and "empfohl" not in s.text.lower()
                    and "angeraten" not in s.text.lower()
                ):
                    errors.append(
                        f"recommendation {rec['id']} must say explicitly that it is recommended"
                    )
                if sec.key != "recommendations":
                    errors.append(
                        f"recommendation {rec['id']} belongs in section `recommendations`"
                    )
            elif s.rec:
                errors.append("`rec` must be null unless role is recommendation")
            elif (
                re.search(r"empf(?:ehl|ohl)", s.text, re.I) and spec.doc_type == "discharge_letter"
            ):
                errors.append(
                    f"only spec recommendations may use 'empfehlen/empfohlen': {s.text[:80]}"
                )
            for m in _DATE.findall(s.text):
                if m not in allowed_dates:
                    errors.append(f"date `{m}` is not in the spec; use only spec dates")
            for m in _EUR.findall(s.text):
                if not any(
                    m.replace("€", "EUR").replace(" Euro", "").strip() in a or a in m
                    for a in allowed_amounts
                ):
                    errors.append(f"amount `{m}` is not in the spec")
            for name in _MED_NAMES:
                if re.search(rf"\b{re.escape(name)}\b", s.text, re.I):
                    errors.append(f"medicine name `{name}` must not appear in prose")
            for name in BLOCKLIST:
                if re.search(rf"\b{re.escape(name)}\b", s.text):
                    errors.append(f"real person name `{name}` is not allowed")
            if not encodable(s.text):
                errors.append("non-Latin-1 characters in text")
    for rid in rec_ids:
        if seen.get(rid, 0) != 1:
            errors.append(
                f"recommendation {rid} must appear exactly once as role recommendation (found {seen.get(rid, 0)})"
            )
    if spec.doc_type == "decision":
        ruling = " ".join(x.text for sec in sections if sec.key == "ruling" for x in sec.sentences)
        musts = []
        if spec.care_level:
            musts.append(f"Stufe {spec.care_level}")
        if spec.amount_cents is not None:
            musts.append(spec.facts_value("amount") or "")
        if spec.reha_centre:
            musts.append(spec.reha_centre)
        if (
            spec.decision_kind in {"level", "amount"}
            and spec.treatment_dates
            and spec.outcome != "rejected"
        ):
            musts.append(spec.treatment_dates[0])
        if spec.decision_kind == "exemption" and spec.outcome != "rejected":
            musts.extend(spec.treatment_dates)
        if spec.aid and spec.outcome != "rejected":
            musts.append(spec.aid)
        for m in musts:
            if m and m not in ruling:
                errors.append(f"the ruling must contain `{m}` verbatim")
    if spec.doc_type == "discharge_letter" and total_chars < 900:
        errors.append("the discharge letter is too short; write the sections in full")
    if total_chars > 9000:
        errors.append("too long; stay within the sentence counts")
    return errors


# ---------------------------------------------------------------------------------------------
# Fake content (tests, dry runs): deterministic, valid by construction.
# ---------------------------------------------------------------------------------------------
def fake_content(spec: DocSpec) -> dict[str, Any]:
    def s(text: str, role: str = "other", rec: str | None = None) -> dict[str, Any]:
        return {"text": text, "role": role, "rec": rec}

    t = spec.doc_type
    if t == "discharge_letter":
        recs = []
        for r in spec.recommendations:
            kw = r["keywords"][0]
            recs.append(
                s(
                    f"Empfohlen wird: {kw} im Anschluss an den Aufenthalt.",
                    "recommendation",
                    r["id"],
                )
            )
        sections = [
            {
                "key": "diagnoses",
                "heading": "Diagnosen",
                "style": "bullets",
                "sentences": [
                    s(f"Zustand nach {spec.clinical_theme}.", "clinical"),
                    s("Arterielle Hypertonie.", "clinical"),
                ],
            },
            {
                "key": "reason",
                "heading": "Aufnahmegrund",
                "style": "prose",
                "sentences": [
                    s(
                        "Die stationäre Aufnahme erfolgte zur weiteren Abklärung und Behandlung.",
                        "clinical",
                    ),
                    s(
                        "Die Patientin bzw. der Patient berichtete über eine zunehmende Schwäche.",
                        "clinical",
                    ),
                ],
            },
            {
                "key": "course",
                "heading": "Verlauf",
                "style": "prose",
                "sentences": [
                    s("Der stationäre Verlauf gestaltete sich ohne Komplikationen.", "clinical"),
                    s(
                        "Unter physiotherapeutischer Anleitung wurde die Mobilisation schrittweise gesteigert.",
                        "clinical",
                    ),
                    s("Die Wundverhältnisse waren reizlos.", "clinical"),
                    s("Laborchemisch zeigten sich keine relevanten Auffälligkeiten.", "clinical"),
                    s(
                        "Die Schmerztherapie wurde im Verlauf schrittweise reduziert und gut vertragen.",
                        "clinical",
                    ),
                    s(
                        "Eine ergänzende Bildgebung ergab keinen Hinweis auf eine Komplikation.",
                        "clinical",
                    ),
                    s(
                        "Die Mobilisation am Gang gelang zuletzt mit Gehhilfe über kurze Strecken.",
                        "clinical",
                    ),
                    s(
                        "Die Ernährung wurde ohne Beschwerden auf Normalkost umgestellt.",
                        "clinical",
                    ),
                ],
            },
            {
                "key": "status",
                "heading": "Status bei Entlassung",
                "style": "prose",
                "sentences": [
                    s(
                        "Bei Entlassung ist der Allgemeinzustand stabil, die Gehstrecke ist noch eingeschränkt.",
                        "clinical",
                    ),
                    s("Kreislauf und Atmung sind unauffällig.", "clinical"),
                ],
            },
            {
                "key": "recommendations",
                "heading": "Empfehlungen und weiteres Vorgehen",
                "style": "prose",
                "sentences": [
                    *recs,
                    s(
                        "Der aktuelle Medikationsplan ist bei der Hausärztin oder dem Hausarzt vorzulegen.",
                        "open_task",
                    ),
                    s("Das Antragsformular wird von der Hausarztpraxis ergänzt.", "open_task"),
                ],
            },
        ]
    elif t == "decision":
        ruling = {
            "approved": "Ihrem Antrag wird stattgegeben.",
            "rejected": "Ihr Antrag wird abgelehnt.",
            "partial": "Ihrem Antrag wird teilweise stattgegeben.",
        }[spec.outcome or "approved"]
        if spec.care_level:
            ruling += f" Es gebührt Pflegegeld der Stufe {spec.care_level}."
        if spec.amount_cents is not None:
            ruling += f" Der Betrag von {spec.facts_value('amount')} wird angewiesen."
        if spec.reha_centre:
            ruling += f" Der Aufenthalt erfolgt in {spec.reha_centre}."
        if (
            spec.outcome != "rejected"
            and spec.decision_kind in {"level", "amount"}
            and spec.treatment_dates
        ):
            ruling += f" Die Leistung gebührt ab {spec.treatment_dates[0]}."
        if spec.outcome != "rejected" and spec.decision_kind == "exemption":
            ruling += (
                f" Die Befreiung gilt von {spec.treatment_dates[0]} bis {spec.treatment_dates[1]}."
            )
        if spec.outcome != "rejected" and spec.aid:
            ruling += f" Bewilligt wird: {spec.aid}."
        sections = [
            {
                "key": "ruling",
                "heading": "Spruch",
                "style": "prose",
                "sentences": [s(ruling, "administrative")],
            },
            {
                "key": "reasons",
                "heading": "Begründung",
                "style": "prose",
                "sentences": [
                    s(
                        f"Ihr Antrag auf {spec.benefit_name} ist bei uns eingelangt.",
                        "administrative",
                    ),
                    s("Die vorgelegten Unterlagen wurden geprüft.", "administrative"),
                    s(
                        "Auf Grundlage dieser Prüfung war wie im Spruch zu entscheiden.",
                        "administrative",
                    ),
                ],
            },
            {
                "key": "notes",
                "heading": "Hinweise",
                "style": "prose",
                "sentences": [
                    s(
                        "Bitte melden Sie uns Änderungen Ihrer persönlichen Verhältnisse.",
                        "open_task",
                    )
                ],
            },
        ]
    elif t in {"document_request", "reminder"}:
        intro = (
            f"Wir beziehen uns auf unser Schreiben vom {spec.previous_letter_date}."
            if t == "reminder"
            else f"Ihr Antrag auf {spec.benefit_name} ist bei uns eingelangt."
        )
        sections = [
            {
                "key": "intro",
                "heading": None,
                "style": "prose",
                "sentences": [s(intro, "administrative")],
            },
            {
                "key": "explanation",
                "heading": None,
                "style": "prose",
                "sentences": [
                    s(
                        "Für die weitere Bearbeitung benötigen wir noch Unterlagen von Ihnen.",
                        "administrative",
                    )
                ],
            },
            {
                "key": "closing",
                "heading": None,
                "style": "prose",
                "sentences": [
                    s(
                        "Sie können die Unterlagen per Post senden oder persönlich abgeben.",
                        "open_task",
                    ),
                    s("Bei Fragen erreichen Sie uns telefonisch.", "other"),
                ],
            },
        ]
    else:
        sections = [
            {
                "key": "diagnosis",
                "heading": None,
                "style": "prose",
                "sentences": [
                    s(
                        f"Diagnose: Zustand nach {spec.clinical_theme or 'Rückenschmerzen'}.",
                        "clinical",
                    )
                ],
            },
            {
                "key": "note",
                "heading": None,
                "style": "prose",
                "sentences": [
                    s(
                        "Diese Honorarnote kann bei Ihrem Krankenversicherungsträger zur Kostenerstattung eingereicht werden.",
                        "administrative",
                    )
                ],
            },
        ]
    return {"sections": sections}
