# ruff: noqa: E501
"""Deterministic document specs: persona + engine gold + catalog -> every administrative fact.

A spec fixes who writes to whom, about which benefit, with which dates, case numbers, deadlines,
amounts and medicine names. The language model never chooses any of these; it only writes prose
around them. All randomness comes from a seeded `random.Random` per document id, so a spec is
reproducible from `(persona id, doc type, seed)`.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import random
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from . import catalog
from .names import (
    CLINIC_NAMES,
    DEPARTMENTS,
    FEMALE_FIRST,
    LOCALITIES,
    MALE_FIRST,
    REHA_CENTRES,
    STREETS,
    SURNAMES,
    TITLES_DOCTOR,
)

DOC_TYPES = (
    "discharge_letter",
    "decision",
    "document_request",
    "reminder",
    "wahlarzt_invoice",
    "prescription",
)
LLM_DOC_TYPES = frozenset(DOC_TYPES) - {"prescription"}

MONTHS_DE = [
    "Jänner",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
]


def fmt_date(day: dt.date, style: str) -> str:
    if style == "long":
        return f"{day.day}. {MONTHS_DE[day.month - 1]} {day.year}"
    if style == "short_pad":
        return f"{day.day:02d}.{day.month:02d}.{day.year}"
    return f"{day.day}.{day.month}.{day.year}"


def fmt_eur(cents: int) -> str:
    euros, rest = divmod(cents, 100)
    whole = f"{euros:,}".replace(",", ".")
    return f"EUR {whole},{rest:02d}"


# ---------------------------------------------------------------------------------------------
# Recommendation kinds documented in discharge letters, keyed by the benefit they route to.
# `keywords`: at least one must occur in the sentence the model writes for this recommendation.
# ---------------------------------------------------------------------------------------------
RECOMMENDATIONS: dict[str, dict[str, Any]] = {
    "medical-rehabilitation": {
        "kind": "rehabilitation",
        "hint": "eine stationäre oder ambulante Rehabilitation (Anschlussheilverfahren) wird empfohlen",
        "keywords": ("Rehabilitation", "Reha", "Anschlussheilverfahren"),
    },
    "pflegegeld": {
        "kind": "care_allowance",
        "hint": "die Antragstellung auf Pflegegeld wird empfohlen",
        "keywords": ("Pflegegeld",),
    },
    "heilbehelfe-hilfsmittel": {
        "kind": "aid",
        "hint": "die Versorgung mit einem Hilfsmittel ({aid}) wird empfohlen",
        "keywords": ("{aid}",),
    },
    "oegk-physiotherapie": {
        "kind": "therapy",
        "hint": "ambulante Physiotherapie wird empfohlen",
        "keywords": ("Physiotherapie", "physiotherapeutisch"),
    },
    "oegk-ergotherapie": {
        "kind": "therapy",
        "hint": "ambulante Ergotherapie wird empfohlen",
        "keywords": ("Ergotherapie", "ergotherapeutisch"),
    },
    "oegk-logopaedie": {
        "kind": "therapy",
        "hint": "ambulante logopädische Therapie wird empfohlen",
        "keywords": ("Logopädie", "logopädisch"),
    },
    "oegk-transportkosten": {
        "kind": "transport",
        "hint": "für die Kontrolltermine wird ein Krankentransport empfohlen",
        "keywords": ("Transport", "Krankentransport", "Fahrtendienst"),
    },
    "pflegeberatung-wien": {
        "kind": "care_counselling",
        "hint": "eine Pflegeberatung für die Angehörigen wird empfohlen",
        "keywords": ("Pflegeberatung", "Beratung"),
    },
    "pflege-mobile-dienste-wien": {
        "kind": "care_services",
        "hint": "mobile Dienste (Heimhilfe oder Hauskrankenpflege) werden empfohlen",
        "keywords": ("Heimhilfe", "Hauskrankenpflege", "mobile"),
    },
    "pflege-24-stunden-betreuung": {
        "kind": "24h_care",
        "hint": "die Organisation einer 24-Stunden-Betreuung wird empfohlen",
        "keywords": ("24-Stunden", "Betreuung"),
    },
    "oegk-wiedereingliederungsgeld": {
        "kind": "return_to_work",
        "hint": "eine Wiedereingliederungsteilzeit wird empfohlen",
        "keywords": ("Wiedereingliederung",),
    },
    "oegk-psychotherapie": {
        "kind": "therapy",
        "hint": "eine ambulante Psychotherapie wird empfohlen",
        "keywords": ("Psychotherapie", "psychotherapeutisch"),
    },
}
AIDS = (
    "Rollator",
    "Duschhocker",
    "Toilettensitzerhöhung",
    "Unterarmstützkrücken",
    "Pflegebett",
    "Badewannenlifter",
    "Leichtgewichtsrollstuhl",
    "Greifzange",
)

# Clinical themes the model may write about: fictional and plausible; never gold.
CLINICAL_THEMES = (
    "Hüftgelenksersatz nach Sturz",
    "Knietotalendoprothese bei Gonarthrose",
    "Schlaganfall mit Halbseitenschwäche",
    "Herzinfarkt mit Stentimplantation",
    "Lungenentzündung bei COPD",
    "dekompensierte Herzinsuffizienz",
    "Bandscheibenoperation der Lendenwirbelsäule",
    "Oberschenkelhalsbruch",
    "Wirbelkörperfraktur bei Osteoporose",
    "entgleister Diabetes mellitus Typ 2",
    "Darmoperation bei Divertikulitis",
    "Schulterprothese nach Oberarmkopffraktur",
    "Exazerbation einer Multiplen Sklerose",
    "Parkinson-Erkrankung mit Gangunsicherheit",
    "Brustkrebsoperation mit anschließender Strahlentherapie",
    "depressive Episode mit stationärer Behandlung",
    "Covid-19-Pneumonie mit Erschöpfung",
    "Sprunggelenksfraktur mit Osteosynthese",
    "Bypassoperation am Herzen",
    "Amputation einer Zehe bei diabetischem Fußsyndrom",
)

_ORTHO = ("Abteilung für Orthopädie und Traumatologie", "Abteilung für Unfallchirurgie")
_GER = ("Abteilung für Akutgeriatrie und Remobilisation",)
THEME_DEPARTMENTS = {
    "Hüftgelenksersatz nach Sturz": _ORTHO + _GER,
    "Knietotalendoprothese bei Gonarthrose": _ORTHO,
    "Schlaganfall mit Halbseitenschwäche": ("Abteilung für Neurologie",) + _GER,
    "Herzinfarkt mit Stentimplantation": (
        "Abteilung für Kardiologie",
        "Abteilung für Innere Medizin",
    ),
    "Lungenentzündung bei COPD": ("Abteilung für Pulmologie", "Abteilung für Innere Medizin"),
    "dekompensierte Herzinsuffizienz": ("Abteilung für Kardiologie", "Abteilung für Innere Medizin")
    + _GER,
    "Bandscheibenoperation der Lendenwirbelsäule": (
        "Abteilung für Orthopädie und Traumatologie",
        "Abteilung für Neurochirurgie",
    ),
    "Oberschenkelhalsbruch": _ORTHO + _GER,
    "Wirbelkörperfraktur bei Osteoporose": _ORTHO + _GER,
    "entgleister Diabetes mellitus Typ 2": ("Abteilung für Innere Medizin",) + _GER,
    "Darmoperation bei Divertikulitis": ("Abteilung für Allgemein- und Viszeralchirurgie",),
    "Schulterprothese nach Oberarmkopffraktur": _ORTHO,
    "Exazerbation einer Multiplen Sklerose": ("Abteilung für Neurologie",),
    "Parkinson-Erkrankung mit Gangunsicherheit": ("Abteilung für Neurologie",) + _GER,
    "Brustkrebsoperation mit anschließender Strahlentherapie": (
        "Abteilung für Onkologie",
        "Abteilung für Allgemein- und Viszeralchirurgie",
    ),
    "depressive Episode mit stationärer Behandlung": (
        "Abteilung für Psychiatrie und Psychotherapie",
    ),
    "Covid-19-Pneumonie mit Erschöpfung": (
        "Abteilung für Pulmologie",
        "Abteilung für Innere Medizin",
    ),
    "Sprunggelenksfraktur mit Osteosynthese": _ORTHO,
    "Bypassoperation am Herzen": ("Abteilung für Herzchirurgie", "Abteilung für Kardiologie"),
    "Amputation einer Zehe bei diabetischem Fußsyndrom": (
        "Abteilung für Allgemein- und Viszeralchirurgie",
        "Abteilung für Innere Medizin",
    ),
}

# Generic INN names (named medicines are administrative facts, quoted verbatim).
MEDICINES = (
    ("Pantoprazol", "40 mg", "1-0-0-0"),
    ("Amlodipin", "5 mg", "1-0-0-0"),
    ("Bisoprolol", "2,5 mg", "1-0-0-0"),
    ("Ramipril", "5 mg", "1-0-0-0"),
    ("Metformin", "1000 mg", "1-0-1-0"),
    ("Atorvastatin", "20 mg", "0-0-1-0"),
    ("Apixaban", "5 mg", "1-0-1-0"),
    ("Enoxaparin", "40 mg", "0-0-1-0 s.c."),
    ("Metamizol", "500 mg", "bei Bedarf bis 1-1-1-1"),
    ("Paracetamol", "500 mg", "bei Bedarf bis 1-1-1-0"),
    ("Macrogol", "13,7 g", "1-0-0-0"),
    ("Torasemid", "10 mg", "1-0-0-0"),
    ("Levothyroxin", "75 µg", "1-0-0-0"),
    ("Acetylsalicylsäure", "100 mg", "1-0-0-0"),
    ("Clopidogrel", "75 mg", "1-0-0-0"),
    ("Sertralin", "50 mg", "1-0-0-0"),
    ("Mirtazapin", "15 mg", "0-0-0-1"),
    ("Colecalciferol", "1000 IE", "1-0-0-0"),
    ("Calciumcarbonat", "500 mg", "1-0-1-0"),
    ("Furosemid", "40 mg", "1-0-0-0"),
    ("Tamsulosin", "0,4 mg", "0-0-1-0"),
    ("Ondansetron", "4 mg", "bei Bedarf"),
    ("Levetiracetam", "500 mg", "1-0-1-0"),
    ("Insulin glargin", "nach Schema", "0-0-1-0"),
    ("Salbutamol", "100 µg", "bei Bedarf"),
    ("Tiotropium", "18 µg", "1-0-0-0"),
    ("Allopurinol", "300 mg", "1-0-0-0"),
    ("Simvastatin", "40 mg", "0-0-1-0"),
    ("Lercanidipin", "10 mg", "1-0-0-0"),
    ("Candesartan", "8 mg", "1-0-0-0"),
)

# Theme-specific discharge medication (generic names, plausible strengths); 0-2 general
# medicines from MEDICINES are added as comorbidity medication.
THEME_MEDS = {
    "Parkinson-Erkrankung mit Gangunsicherheit": [
        ("Levodopa/Benserazid", "100/25 mg", "1-1-1-0"),
        ("Pramipexol", "0,18 mg", "1-1-1-0"),
        ("Rasagilin", "1 mg", "1-0-0-0"),
    ],
    "Herzinfarkt mit Stentimplantation": [
        ("Acetylsalicylsäure", "100 mg", "1-0-0-0"),
        ("Ticagrelor", "90 mg", "1-0-1-0"),
        ("Atorvastatin", "80 mg", "0-0-1-0"),
        ("Bisoprolol", "2,5 mg", "1-0-0-0"),
        ("Ramipril", "5 mg", "1-0-0-0"),
    ],
    "Bypassoperation am Herzen": [
        ("Acetylsalicylsäure", "100 mg", "1-0-0-0"),
        ("Atorvastatin", "40 mg", "0-0-1-0"),
        ("Bisoprolol", "5 mg", "1-0-0-0"),
        ("Metamizol", "500 mg", "bei Bedarf bis 1-1-1-1"),
    ],
    "dekompensierte Herzinsuffizienz": [
        ("Torasemid", "10 mg", "1-0-0-0"),
        ("Bisoprolol", "2,5 mg", "1-0-0-0"),
        ("Ramipril", "2,5 mg", "1-0-0-0"),
        ("Spironolacton", "25 mg", "1-0-0-0"),
        ("Empagliflozin", "10 mg", "1-0-0-0"),
    ],
    "Schlaganfall mit Halbseitenschwäche": [
        ("Acetylsalicylsäure", "100 mg", "1-0-0-0"),
        ("Atorvastatin", "40 mg", "0-0-1-0"),
        ("Ramipril", "5 mg", "1-0-0-0"),
    ],
    "Lungenentzündung bei COPD": [
        ("Tiotropium", "18 µg", "1-0-0-0"),
        ("Salbutamol", "100 µg", "bei Bedarf"),
        ("Prednisolon", "25 mg", "1-0-0-0 für 3 Tage"),
        ("Amoxicillin/Clavulansäure", "875/125 mg", "1-0-1-0 für 5 Tage"),
    ],
    "Covid-19-Pneumonie mit Erschöpfung": [
        ("Enoxaparin", "40 mg", "0-0-1-0 s.c."),
        ("Paracetamol", "500 mg", "bei Bedarf bis 1-1-1-0"),
    ],
    "entgleister Diabetes mellitus Typ 2": [
        ("Metformin", "1000 mg", "1-0-1-0"),
        ("Insulin glargin", "nach Schema", "0-0-1-0"),
        ("Empagliflozin", "10 mg", "1-0-0-0"),
    ],
    "Amputation einer Zehe bei diabetischem Fußsyndrom": [
        ("Metformin", "1000 mg", "1-0-1-0"),
        ("Insulin glargin", "nach Schema", "0-0-1-0"),
        ("Amoxicillin/Clavulansäure", "875/125 mg", "1-0-1-0 für 7 Tage"),
    ],
    "depressive Episode mit stationärer Behandlung": [
        ("Sertralin", "100 mg", "1-0-0-0"),
        ("Mirtazapin", "15 mg", "0-0-0-1"),
    ],
    "Exazerbation einer Multiplen Sklerose": [
        ("Colecalciferol", "1000 IE", "1-0-0-0"),
        ("Pantoprazol", "40 mg", "1-0-0-0"),
    ],
    "Brustkrebsoperation mit anschließender Strahlentherapie": [
        ("Letrozol", "2,5 mg", "1-0-0-0"),
        ("Metamizol", "500 mg", "bei Bedarf bis 1-1-1-1"),
        ("Ondansetron", "4 mg", "bei Bedarf"),
    ],
    "Darmoperation bei Divertikulitis": [
        ("Metamizol", "500 mg", "1-1-1-1"),
        ("Pantoprazol", "40 mg", "1-0-0-0"),
        ("Macrogol", "13,7 g", "1-0-0-0"),
        ("Enoxaparin", "40 mg", "0-0-1-0 s.c."),
    ],
    "Wirbelkörperfraktur bei Osteoporose": [
        ("Alendronsäure", "70 mg", "1x wöchentlich"),
        ("Colecalciferol", "1000 IE", "1-0-0-0"),
        ("Calciumcarbonat", "500 mg", "1-0-1-0"),
        ("Metamizol", "500 mg", "1-1-1-1"),
    ],
}
_ORTHO_MEDS = [
    ("Enoxaparin", "40 mg", "0-0-1-0 s.c."),
    ("Metamizol", "500 mg", "1-1-1-1"),
    ("Paracetamol", "500 mg", "bei Bedarf bis 1-1-1-0"),
    ("Pantoprazol", "40 mg", "1-0-0-0"),
]
for _t in (
    "Hüftgelenksersatz nach Sturz",
    "Knietotalendoprothese bei Gonarthrose",
    "Bandscheibenoperation der Lendenwirbelsäule",
    "Oberschenkelhalsbruch",
    "Schulterprothese nach Oberarmkopffraktur",
    "Sprunggelenksfraktur mit Osteosynthese",
):
    THEME_MEDS[_t] = _ORTHO_MEDS
ALL_MEDICINE_NAMES = sorted(
    {m[0] for m in MEDICINES} | {m[0] for v in THEME_MEDS.values() for m in v}
)

# Appeal routes printed on decisions. Synthetic letters: the routes are modelled on Austrian
# practice (ASGG § 67 for social-insurance benefits, BAO for the tax office, VwGVG for
# provincial authorities) but are not legal advice.
APPEAL = {
    "kv": {
        "period": "vier Wochen",
        "period_nom": "vier Wochen",
        "days": 28,
        "body": "beim {court} schriftlich Klage zu erheben",
        "plain": "beim {court} schriftlich Klage erheben",
        "noun": "Klage",
        "route": "Klage beim Arbeits- und Sozialgericht",
    },
    "pv": {
        "period": "drei Monaten",
        "period_nom": "drei Monate",
        "days": 91,
        "body": "beim {court} schriftlich Klage zu erheben",
        "plain": "beim {court} schriftlich Klage erheben",
        "noun": "Klage",
        "route": "Klage beim Arbeits- und Sozialgericht",
    },
    "finanzamt": {
        "period": "einem Monat",
        "period_nom": "einen Monat",
        "days": 30,
        "body": "beim Finanzamt Österreich schriftlich Beschwerde einzubringen",
        "plain": "beim Finanzamt Österreich schriftlich Beschwerde einbringen",
        "noun": "Beschwerde",
        "route": "Beschwerde beim Finanzamt",
    },
    "authority": {
        "period": "vier Wochen",
        "period_nom": "vier Wochen",
        "days": 28,
        "body": "bei der Behörde, die diesen Bescheid erlassen hat, schriftlich Beschwerde an das Landesverwaltungsgericht einzubringen",
        "plain": "bei der Behörde, die diesen Bescheid erlassen hat, schriftlich Beschwerde an das Landesverwaltungsgericht einbringen",
        "noun": "Beschwerde",
        "route": "Beschwerde an das Landesverwaltungsgericht",
    },
}
APPEAL["sms"] = {
    "period": "vier Wochen",
    "period_nom": "vier Wochen",
    "days": 28,
    "body": "beim Sozialministeriumservice schriftlich Beschwerde an das Bundesverwaltungsgericht einzubringen",
    "plain": "beim Sozialministeriumservice schriftlich Beschwerde an das Bundesverwaltungsgericht einbringen",
    "noun": "Beschwerde",
    "route": "Beschwerde an das Bundesverwaltungsgericht",
}
# Labour and social courts by the recipient's town (residence decides the competent court).
LOCAL_COURTS = {
    "Wiener Neustadt": "Wiener Neustadt",
    "Baden": "Wiener Neustadt",
    "Mödling": "Wiener Neustadt",
    "Krems an der Donau": "Krems an der Donau",
    "Zwettl": "Krems an der Donau",
    "Hollabrunn": "Korneuburg",
    "St. Pölten": "St. Pölten",
    "Amstetten": "St. Pölten",
    "Leoben": "Leoben",
    "Kapfenberg": "Leoben",
    "Liezen": "Leoben",
    "Wels": "Wels",
    "Gmunden": "Wels",
    "Steyr": "Steyr",
    "Ried im Innkreis": "Ried im Innkreis",
    "Braunau am Inn": "Ried im Innkreis",
    "Freistadt": "Linz",
    "Linz": "Linz",
}
COURTS = {
    "Wien": "Arbeits- und Sozialgericht Wien",
    "Niederösterreich": "Landesgericht St. Pölten als Arbeits- und Sozialgericht",
    "Burgenland": "Landesgericht Eisenstadt als Arbeits- und Sozialgericht",
    "Oberösterreich": "Landesgericht Linz als Arbeits- und Sozialgericht",
    "Steiermark": "Landesgericht für Zivilrechtssachen Graz als Arbeits- und Sozialgericht",
    "Kärnten": "Landesgericht Klagenfurt als Arbeits- und Sozialgericht",
    "Salzburg": "Landesgericht Salzburg als Arbeits- und Sozialgericht",
    "Tirol": "Landesgericht Innsbruck als Arbeits- und Sozialgericht",
    "Vorarlberg": "Landesgericht Feldkirch als Arbeits- und Sozialgericht",
}
PV_BENEFITS = {"pflegegeld", "medical-rehabilitation"}

INVOICE_SPECIALTIES = {
    "oegk-wahlarzt-kostenerstattung": (
        ("Fachärztin für Innere Medizin", "Facharzt für Innere Medizin"),
        (
            "Ordinationsleistung, Erstkonsultation",
            "Internistische Kontrolluntersuchung",
            "Ruhe-EKG",
        ),
    ),
    "oegk-physiotherapie": (
        ("Physiotherapeutin", "Physiotherapeut"),
        ("Physiotherapie Einzeltherapie 45 Minuten", "Physiotherapie Einzeltherapie 30 Minuten"),
    ),
    "oegk-ergotherapie": (
        ("Ergotherapeutin", "Ergotherapeut"),
        ("Ergotherapie Einzeltherapie 60 Minuten", "Ergotherapie Einzeltherapie 30 Minuten"),
    ),
    "oegk-logopaedie": (
        ("Logopädin", "Logopäde"),
        ("Logopädische Einzeltherapie 45 Minuten", "Logopädische Befunderhebung"),
    ),
    "oegk-psychotherapie": (
        ("Psychotherapeutin", "Psychotherapeut"),
        ("Psychotherapeutische Einzelsitzung 50 Minuten",),
    ),
    "oegk-heilmassage": (
        ("Heilmasseurin", "Heilmasseur"),
        ("Heilmassage Teilmassage 30 Minuten", "Heilmassage Ganzkörper 50 Minuten"),
    ),
    "oegk-klinisch-psychologische-diagnostik": (
        ("Klinische Psychologin", "Klinischer Psychologe"),
        ("Klinisch-psychologische Diagnostik, Testung", "Befundbesprechung"),
    ),
    "oegk-zahnbehandlung": (
        ("Zahnärztin", "Zahnarzt"),
        ("Mundhygiene", "Kompositfüllung zweiflächig", "Röntgen Einzelzahnaufnahme"),
    ),
}

SCENARIO_DOCS: dict[str, tuple[tuple[str, float], ...]] = {
    "rehab_after_hospital": (
        ("discharge_letter", 0.5),
        ("decision", 0.25),
        ("document_request", 0.15),
        ("reminder", 0.1),
    ),
    "care_for_parent": (
        ("discharge_letter", 0.4),
        ("decision", 0.3),
        ("document_request", 0.2),
        ("reminder", 0.1),
    ),
    "care_for_self": (
        ("discharge_letter", 0.4),
        ("decision", 0.3),
        ("document_request", 0.2),
        ("reminder", 0.1),
    ),
    "home_care_24h": (("discharge_letter", 0.4), ("decision", 0.3), ("document_request", 0.3)),
    "aids_and_devices": (
        ("discharge_letter", 0.3),
        ("prescription", 0.3),
        ("decision", 0.25),
        ("document_request", 0.15),
    ),
    "therapy_after_illness": (
        ("discharge_letter", 0.3),
        ("wahlarzt_invoice", 0.3),
        ("prescription", 0.2),
        ("decision", 0.2),
    ),
    "transport_to_treatment": (
        ("discharge_letter", 0.4),
        ("decision", 0.35),
        ("document_request", 0.25),
    ),
    "gradual_return_to_work": (
        ("discharge_letter", 0.35),
        ("decision", 0.35),
        ("document_request", 0.3),
    ),
    "private_doctor_refund": (
        ("wahlarzt_invoice", 0.55),
        ("decision", 0.25),
        ("document_request", 0.2),
    ),
    "mental_health_support": (
        ("wahlarzt_invoice", 0.45),
        ("decision", 0.3),
        ("document_request", 0.25),
    ),
    "prescription_fee_relief": (
        ("prescription", 0.4),
        ("decision", 0.35),
        ("document_request", 0.25),
    ),
    "dental_work": (("wahlarzt_invoice", 0.35), ("decision", 0.4), ("document_request", 0.25)),
    "sick_pay": (("decision", 0.4), ("document_request", 0.35), ("reminder", 0.25)),
}
DEFAULT_DOCS = (("decision", 0.45), ("document_request", 0.35), ("reminder", 0.2))
NO_LETTER_OFFICES = {"praevention-programmzugang"}
# What a decision letter grants, per benefit; benefits not listed get no decision letter.
DECISION_KINDS = {
    "pflegegeld": "level",
    "medical-rehabilitation": "centre",
    "rezeptgebuehrenbefreiung": "exemption",
    "bewilligung-chef-kontrollaerztlicher-dienst": "approval",
    "heilbehelfe-hilfsmittel": "approval",
    "oegk-geplante-auslandsbehandlung": "approval",
    "oegk-wiedereingliederungsgeld": "approval",
    "oegk-krankengeld": "amount",
    "oegk-wahlarzt-kostenerstattung": "amount",
    "oegk-physiotherapie": "amount",
    "oegk-ergotherapie": "amount",
    "oegk-logopaedie": "amount",
    "oegk-psychotherapie": "amount",
    "oegk-heilmassage": "amount",
    "oegk-klinisch-psychologische-diagnostik": "amount",
    "oegk-klinisch-psychologische-behandlung": "amount",
    "oegk-zahnbehandlung": "amount",
    "oegk-zahnersatz": "amount",
    "oegk-transportkosten": "amount",
    "oegk-urlaubsbehandlung": "amount",
    "familie-familienbeihilfe": "amount",
    "familie-kinderbetreuungsgeld": "amount",
    "pflegekarenzgeld": "amount",
    "sozialhilfe-wien": "amount",
    "sozialhilfe-steiermark": "amount",
}
# Plausible amount ranges (EUR) and basis for decision letters (synthetic, not tariffs).
AMOUNT_RANGES = {
    "oegk-krankengeld": (25, 95, "täglich"),
    "familie-kinderbetreuungsgeld": (18, 80, "täglich"),
    "familie-familienbeihilfe": (138, 330, "monatlich"),
    "pflegekarenzgeld": (400, 1800, "monatlich"),
    "pflege-24-stunden-betreuung": (400, 1600, "monatlich"),
    "sozialhilfe-wien": (250, 1300, "monatlich"),
    "sozialhilfe-steiermark": (250, 1300, "monatlich"),
    "oegk-transportkosten": (15, 260, "einmalig"),
    "oegk-zahnersatz": (150, 900, "einmalig"),
    "oegk-zahnspange": (300, 2000, "einmalig"),
    "oegk-psychotherapie": (28, 600, "einmalig"),
}
REFUND_BENEFITS = {
    "oegk-wahlarzt-kostenerstattung",
    "oegk-physiotherapie",
    "oegk-ergotherapie",
    "oegk-logopaedie",
    "oegk-psychotherapie",
    "oegk-heilmassage",
    "oegk-klinisch-psychologische-diagnostik",
    "oegk-klinisch-psychologische-behandlung",
    "oegk-zahnbehandlung",
    "oegk-zahnersatz",
    "oegk-transportkosten",
    "oegk-urlaubsbehandlung",
}
# Pflegegeld per month by level (2025 values, EUR cents).
PFLEGEGELD_CENTS = {1: 20080, 2: 37030, 3: 57700, 4: 86510, 5: 117520, 6: 164110, 7: 215660}
LEGAL_BASIS = {
    "pflegegeld": "Bundespflegegeldgesetz (BPGG)",
    "pflegekarenzgeld": "§ 21c Bundespflegegeldgesetz (BPGG)",
    "familie-familienbeihilfe": "Familienlastenausgleichsgesetz 1967 (FLAG 1967)",
    "familie-kinderbetreuungsgeld": "Kinderbetreuungsgeldgesetz (KBGG)",
    "sozialhilfe-wien": "Wiener Mindestsicherungsgesetz (WMG)",
    "sozialhilfe-steiermark": "Steiermärkisches Sozialunterstützungsgesetz (StSUG)",
}
CARRIER_LAW = {
    "oegk": "Allgemeines Sozialversicherungsgesetz (ASVG)",
    "pva": "Allgemeines Sozialversicherungsgesetz (ASVG)",
    "svs": "Gewerbliches Sozialversicherungsgesetz (GSVG)",
    "bvaeb": "Beamten-Kranken- und Unfallversicherungsgesetz (B-KUVG)",
    "auva": "Allgemeines Sozialversicherungsgesetz (ASVG)",
}
REJECTION_REASONS = {
    "level": [
        "Der bei der Begutachtung festgestellte Pflegebedarf beträgt durchschnittlich weniger als 65 Stunden monatlich."
    ],
    "centre": [
        "Die eingereichten ärztlichen Unterlagen lassen nach Prüfung durch den ärztlichen Dienst keine Bewilligung zu.",
        "Die angeforderten Unterlagen wurden trotz Aufforderung nicht vorgelegt.",
    ],
    "exemption": [
        "Das monatliche Haushaltseinkommen übersteigt den maßgeblichen Richtsatz.",
        "Die angeforderten Einkommensnachweise wurden trotz Aufforderung nicht vorgelegt.",
    ],
    "approval": [
        "Die Voraussetzungen für eine Bewilligung sind laut Prüfung durch den ärztlichen Dienst nicht erfüllt.",
        "Die angeforderten Unterlagen wurden trotz Aufforderung nicht vorgelegt.",
    ],
    "amount": [
        "Die angeforderten Unterlagen wurden trotz Aufforderung nicht vorgelegt.",
        "Die Anspruchsvoraussetzungen sind laut den vorgelegten Nachweisen nicht erfüllt.",
        "Die vorgelegten Nachweise belegen den geltend gemachten Anspruch für den beantragten Zeitraum nicht.",
    ],
}
PARTIAL_REASONS = [
    "Ein Teil der eingereichten Kosten betrifft Leistungen, für die kein Kostenersatz vorgesehen ist.",
    "Der Kostenersatz wird nach dem Tarif des Versicherungsträgers berechnet und liegt unter dem beantragten Betrag.",
]
# Benefits that never produce office letters (programmes, counselling, employer agreements).
NO_LETTER_BENEFITS = {
    "familie-eltern-kind-pass",
    "familie-familienberatung",
    "familie-kinderimpfprogramm",
    "oegk-vertragsarzt",
    "pflegeberatung-wien",
    "pflegekarenz",
    "pflegeteilzeit",
    "oegk-heilmittel",
    "eko-medikamente-kostenuebernahme",
    "oegk-krankenhauspflege",
}
# Catalog documents that make no sense in a request letter of the office itself.
NO_REQUEST_DOCS = {
    "application",
    "application-form",
    "finance-letter",
    "requested-evidence",
    "approval",
    "bewilligung",
    "written-approval",
}


@dataclass
class Person:
    first: str
    last: str
    sex: str
    birth_date: str
    insurance_number: str
    street: str
    postal_code: str
    locality: str
    title: str = ""

    @property
    def full(self) -> str:
        return f"{self.title + ' ' if self.title else ''}{self.first} {self.last}"

    @property
    def salutation(self) -> str:
        if self.sex == "f":
            return f"Sehr geehrte Frau {self.last}"
        if self.sex == "m":
            return f"Sehr geehrter Herr {self.last}"
        return f"Guten Tag {self.first} {self.last}"

    @property
    def anrede(self) -> str:
        return {"f": "Frau", "m": "Herr"}.get(self.sex, "")


@dataclass
class Issuer:
    name: str
    lines: list[str]  # department / address lines under the name
    phone: str | None
    email: str | None
    kind: str  # hospital | carrier:<id> | finanzamt | authority | practice | other
    fictional: bool
    office_id: str | None = None
    signatory: str = ""


@dataclass
class DocSpec:
    doc_id: str
    persona_id: str
    split: str
    doc_type: str
    register: str  # standard | plain
    seed: int
    letter_date: str
    date_style: str
    issuer: Issuer
    patient: Person
    recipient: Person
    carrier: str | None
    carrier_name: str | None
    benefit_id: str | None
    benefit_name: str | None
    goal: str
    scenario: str
    life_situation: str
    reference: str  # case number / Zahl / Fallzahl / invoice number
    reference_label: str
    facts: list[dict[str, str]] = field(default_factory=list)  # {type, label, value} header facts
    outcome: str | None = None  # approved | rejected | partial
    care_level: int | None = None
    amount_cents: int | None = None
    deadline: dict[str, Any] | None = None
    appeal: dict[str, Any] | None = None
    requested_documents: list[dict[str, str]] = field(default_factory=list)
    previous_letter_date: str | None = None
    medicines: list[dict[str, str]] = field(default_factory=list)
    recommendations: list[dict[str, Any]] = field(default_factory=list)
    follow_up: dict[str, str] | None = None
    admission_date: str | None = None
    discharge_date: str | None = None
    clinical_theme: str | None = None
    invoice_items: list[dict[str, Any]] = field(default_factory=list)
    treatment_dates: list[str] = field(default_factory=list)
    reha_centre: str | None = None
    legal_basis: str | None = None
    application_date: str | None = None
    decision_reason: str | None = None
    decision_kind: str | None = None
    amount_basis: str | None = None
    aid: str | None = None
    prescription_kind: str | None = None
    layout: dict[str, Any] = field(default_factory=dict)
    gold_benefits: list[str] = field(default_factory=list)
    gold_offices: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, sort_keys=True)

    @classmethod
    def from_json(cls, text: str) -> DocSpec:
        data = json.loads(text)
        data["issuer"] = Issuer(**data["issuer"])
        data["patient"] = Person(**data["patient"])
        data["recipient"] = Person(**data["recipient"])
        return cls(**data)

    def facts_value(self, type_: str) -> str | None:
        return next((f["value"] for f in self.facts if f["type"] == type_), None)

    def value(self, day: dt.date) -> str:
        return fmt_date(day, self.date_style)


def _seed(*parts: Any) -> int:
    return int.from_bytes(hashlib.sha256("|".join(map(str, parts)).encode()).digest()[:8], "big")


def _vsnr(rng: random.Random, birth: dt.date) -> str:
    """Austrian insurance-number shape with a deliberately WRONG check digit (never a real VSNR)."""
    while True:
        serial = [rng.randint(1, 9), rng.randint(0, 9), rng.randint(0, 9)]
        date_digits = [int(c) for c in birth.strftime("%d%m%y")]
        weights_serial, weights_date = (3, 7, 9), (5, 8, 4, 2, 1, 6)
        total = sum(a * b for a, b in zip(serial, weights_serial, strict=True))
        total += sum(a * b for a, b in zip(date_digits, weights_date, strict=True))
        check = total % 11
        if check == 10:
            continue
        wrong = (check + rng.randint(1, 9)) % 10
        return f"{serial[0]}{serial[1]}{serial[2]}{wrong} {birth.strftime('%d%m%y')}"


def _locality(rng: random.Random, state: str, district: Any) -> tuple[str, str]:
    if state == "Wien":
        d = (
            int(district)
            if isinstance(district, int) or str(district).isdigit()
            else rng.randint(1, 23)
        )
        return f"1{d:02d}0", "Wien"
    options = LOCALITIES.get(state) or LOCALITIES["Niederösterreich"]
    return rng.choice(options)


def _person(rng: random.Random, member: dict[str, Any], today: dt.date) -> Person:
    sex = member.get("sex") or rng.choice("fm")
    first = rng.choice(
        FEMALE_FIRST if sex == "f" else MALE_FIRST if sex == "m" else FEMALE_FIRST + MALE_FIRST
    )
    age = int(member.get("age") or rng.randint(25, 80))
    birth = today - dt.timedelta(days=int(age * 365.25 + rng.randint(1, 360)))
    plz, loc = _locality(
        rng,
        (member.get("residence") or {}).get("state") or "Wien",
        (member.get("residence") or {}).get("district"),
    )
    return Person(
        first=first,
        last=rng.choice(SURNAMES),
        sex=sex,
        birth_date=fmt_date(birth, "short_pad"),
        insurance_number=_vsnr(rng, birth),
        street=f"{rng.choice(STREETS)} {rng.randint(1, 120)}{rng.choice(['', '', '', '/2', '/5', '/12', '/3/7'])}",
        postal_code=plz,
        locality=loc,
    )


def _doctor(rng: random.Random, hospital: bool = False) -> str:
    sex = rng.choice("fm")
    first = rng.choice(FEMALE_FIRST if sex == "f" else MALE_FIRST)
    if hospital:  # the rank is printed under the signature; no rank in the title
        title = (
            "Dr.in" if sex == "f" and rng.random() < 0.5 else rng.choice(["Dr.", "Dr. med. univ."])
        )
    else:
        title = rng.choice(TITLES_DOCTOR)
    return f"{title} {first} {rng.choice(SURNAMES)}"


def _clean_doc_name(name: str) -> str:
    name = re.sub(r"^(Bei [^:]{1,40}:|Beim [^:]{1,40}:|Falls zutreffend:)\s*", "", name)
    name = re.sub(
        r",\s*(falls erforderlich|soweit zutreffend|wenn vorhanden und zutreffend|wenn möglich)$",
        "",
        name,
    )
    return name[:1].upper() + name[1:]


def choose_doc_type(
    rng: random.Random, scenario: str, goal_office: str | None, goal: str = ""
) -> str | None:
    table = SCENARIO_DOCS.get(scenario, DEFAULT_DOCS)
    if goal not in DECISION_KINDS:
        table = tuple((t, w) for t, w in table if t != "decision")
    if goal in NO_LETTER_BENEFITS or goal.startswith("praevention-"):
        table = tuple((t, w) for t, w in table if t not in {"document_request", "reminder"})
    if not table:
        return None
    if goal_office is None or goal_office in NO_LETTER_OFFICES:
        table = tuple(
            (t, w)
            for t, w in table
            if t in {"discharge_letter", "wahlarzt_invoice", "prescription"}
        )
        if not table:
            return None
    types, weights = zip(*table, strict=True)
    return rng.choices(types, weights=weights)[0]


def build_spec(
    persona: dict[str, Any], doc_type: str | None = None, seed: int = 0
) -> DocSpec | None:
    """Spec for one document of `persona` (a row of the personas parquet with JSON strings decoded)."""
    household = persona["household"]
    gold = persona["gold"]
    subject = next((m for m in household if m.get("role") == "subject"), household[0])
    goal = persona["goal"]
    offices = catalog.offices()
    benefits = catalog.benefits()
    goal_office = (gold.get("offices") or {}).get(goal)
    rng = random.Random(_seed(persona["id"], doc_type or "auto", seed))
    if doc_type is None:
        doc_type = choose_doc_type(rng, persona.get("scenario", ""), goal_office, goal)
        if doc_type is None:
            return None
    today = dt.date(2025, 1, 7) + dt.timedelta(days=rng.randint(0, 640))
    while today.weekday() >= 5:
        today += dt.timedelta(days=1)
    date_style = rng.choices(["short_pad", "short", "long"], weights=[0.6, 0.15, 0.25])[0]
    patient = _person(rng, subject, today)
    helper = next((m for m in household if m.get("role") == "helper"), None)
    recipient = patient
    carrier = (subject.get("insurance") or {}).get("carrier")
    register = "plain" if rng.random() < 0.25 else "standard"
    doc_id = f"doc-{hashlib.sha256(f'{persona["id"]}|{doc_type}|{seed}'.encode()).hexdigest()[:12]}"
    benefit = benefits.get(goal)
    layout = {
        "font": rng.choice(["Helvetica", "Helvetica", "Times-Roman", "Courier"]),
        "size": rng.choice([9.5, 10.0, 10.0, 10.5, 11.0]),
        "letterhead": rng.choice(["left", "right", "center"]),
        "margin_mm": rng.choice([18, 20, 22, 25]),
        "rule": rng.random() < 0.6,
        "info_block": rng.choice(["right", "below"]),
    }
    spec = DocSpec(
        doc_id=doc_id,
        persona_id=persona["id"],
        split=persona.get("split", "train"),
        doc_type=doc_type,
        register=register
        if doc_type in {"decision", "document_request", "reminder"}
        else "standard",
        seed=seed,
        letter_date=fmt_date(today, date_style),
        date_style=date_style,
        issuer=Issuer(name="", lines=[], phone=None, email=None, kind="other", fictional=True),
        patient=patient,
        recipient=recipient,
        carrier=carrier,
        carrier_name=catalog.CARRIER_NAMES.get(carrier or ""),
        benefit_id=goal if benefit else None,
        benefit_name=benefit.name_de if benefit else None,
        goal=goal,
        scenario=persona.get("scenario", ""),
        life_situation=persona.get("life_situation", ""),
        reference="",
        reference_label="",
        layout=layout,
        gold_benefits=list(gold.get("benefits") or []),
        gold_offices=dict(gold.get("offices") or {}),
    )
    builder = {
        "discharge_letter": _discharge,
        "decision": _decision,
        "document_request": _request,
        "reminder": _request,
        "wahlarzt_invoice": _invoice,
        "prescription": _prescription,
    }[doc_type]
    if not builder(spec, rng, today, subject, helper, offices, benefits, goal_office):
        return None
    return spec


def _fact(spec: DocSpec, type_: str, label: str, value: str) -> None:
    spec.facts.append({"type": type_, "label": label, "value": value})


def _carrier_fact_value(spec: DocSpec) -> str | None:
    if not spec.carrier:
        return None
    return catalog.CARRIER_SHORT.get(spec.carrier, spec.carrier.upper())


def _discharge(spec, rng, today, subject, helper, offices, benefits, goal_office) -> bool:
    clinic, place = rng.choice(CLINIC_NAMES)
    theme = rng.choice(CLINICAL_THEMES)
    department = rng.choice(THEME_DEPARTMENTS.get(theme, DEPARTMENTS))
    spec.issuer = Issuer(
        name=clinic,
        lines=[department, f"{rng.choice(STREETS)} {rng.randint(1, 80)}", place],
        phone=f"+43 {rng.randint(2600, 7999)} {rng.randint(100, 999)}-{rng.randint(0, 9999):04d}",
        email=None,
        kind="hospital",
        fictional=True,
        signatory=_doctor(rng, hospital=True),
    )
    discharge = today - dt.timedelta(days=rng.randint(0, 3))
    admission = discharge - dt.timedelta(days=rng.randint(3, 24))
    spec.admission_date = spec.value(admission)
    spec.discharge_date = spec.value(discharge)
    spec.reference = f"{rng.randint(10, 99)}{rng.randint(100000, 999999)}"
    spec.reference_label = rng.choice(["Fallzahl", "Aufnahmezahl", "Fall-Nr."])
    spec.clinical_theme = theme
    _fact(spec, "institution", "Einrichtung", spec.issuer.name)
    _fact(spec, "institution", "Abteilung", department)
    _fact(spec, "case_number", spec.reference_label, spec.reference)
    _fact(spec, "admission_date", "Aufnahme", spec.admission_date)
    _fact(spec, "discharge_date", "Entlassung", spec.discharge_date)
    _fact(spec, "insurance_number", "SV-Nummer", spec.patient.insurance_number)
    if cv := _carrier_fact_value(spec):
        _fact(spec, "carrier", "Versicherung", cv)
    level = (subject.get("care") or {}).get("pflegegeld_level")
    if level:
        spec.care_level = int(level)
        _fact(spec, "care_level", "Pflegegeldstufe", f"Stufe {int(level)}")
    theme_meds = THEME_MEDS.get(spec.clinical_theme or "", [])
    meds = rng.sample(theme_meds, min(len(theme_meds), rng.randint(2, 4))) if theme_meds else []
    names = {m[0] for m in meds}
    extra = [m for m in MEDICINES if m[0] not in names]
    meds += rng.sample(extra, rng.randint(0 if len(meds) >= 2 else 2, 2))
    spec.medicines = [{"name": n, "strength": s, "schema": sch} for n, s, sch in meds]
    # recommendations: navigation benefits in the persona's gold, goal first
    candidates = [b for b in [spec.goal, *spec.gold_benefits] if b in RECOMMENDATIONS]
    seen: list[str] = []
    for b in candidates:
        if b not in seen:
            seen.append(b)
    if not seen:
        seen = ["oegk-physiotherapie"] if "oegk-physiotherapie" in spec.gold_benefits else []
    chosen = seen[:1] + rng.sample(seen[1:], k=max(0, min(len(seen) - 1, rng.randint(0, 2))))
    aid = rng.choice(AIDS)
    spec.aid = aid
    for i, b in enumerate(chosen):
        rec = RECOMMENDATIONS[b]
        spec.recommendations.append(
            {
                "id": f"R{i + 1}",
                "benefit": b,
                "kind": rec["kind"],
                "hint": rec["hint"].format(aid=aid),
                "keywords": [k.format(aid=aid) for k in rec["keywords"]],
                "office": spec.gold_offices.get(b),
            }
        )
    follow = discharge + dt.timedelta(days=rng.randint(10, 60))
    while follow.weekday() >= 5:
        follow += dt.timedelta(days=1)
    spec.follow_up = {
        "date": spec.value(follow),
        "time": f"{rng.randint(7, 14)}:{rng.choice(['00', '15', '30', '45'])} Uhr",
        "place": rng.choice(["Ambulanz", "Spezialambulanz", "Tagesklinik"])
        + f" der Abteilung ({department})",
    }
    return True


def _carrier_issuer(spec: DocSpec, rng: random.Random, offices, goal_office) -> bool:
    office = offices.get(goal_office) if isinstance(goal_office, str) else None
    if office is None or office.id in NO_LETTER_OFFICES:
        return False
    kind = catalog.office_kind(office)
    kv = {"oegk", "svs", "bvaeb"}
    if kind in kv and spec.carrier in kv and spec.carrier != kind:
        return False  # the persona is insured elsewhere: such a letter would be inconsistent
    if kind == "authority" and office.postal_code and office.region == "Steiermark":
        # district authorities serve their district: the recipient lives there
        spec.patient.postal_code, spec.patient.locality = office.postal_code, office.locality
    spec.issuer = Issuer(
        name=office.name_de,
        lines=office.address_lines,
        phone=office.phone,
        email=office.email,
        kind=f"carrier:{kind}" if kind in catalog.CARRIER_NAMES else kind,
        fictional=False,
        office_id=office.id,
        signatory=f"{rng.choice(FEMALE_FIRST + MALE_FIRST)} {rng.choice(SURNAMES)}",
    )
    prefix = {"oegk": "ÖGK", "pva": "PVA", "svs": "SVS", "bvaeb": "BVAEB", "auva": "AUVA"}.get(
        kind, "GZ"
    )
    spec.reference = f"{prefix}-{spec_year(spec)}-{rng.randint(100000, 999999)}"
    if kind == "finanzamt":
        spec.reference = f"{rng.randint(10, 99)} {rng.randint(100, 999)}/{rng.randint(1000, 9999)}"
    spec.reference_label = rng.choice(["Geschäftszahl", "Aktenzeichen", "Unser Zeichen", "Zahl"])
    _fact(spec, "institution", "Absender", office.name_de)
    _fact(spec, "case_number", spec.reference_label, spec.reference)
    _fact(spec, "document_date", "Datum", spec.letter_date)
    if kind in catalog.CARRIER_NAMES or kind == "finanzamt":
        _fact(spec, "insurance_number", "Versicherungsnummer", spec.patient.insurance_number)
    return True


def spec_year(spec: DocSpec) -> int:
    return int(re.findall(r"\d{4}", spec.letter_date)[-1])


def _appeal(spec: DocSpec, office_kind: str, region: str | None) -> dict[str, Any]:
    if office_kind == "finanzamt":
        route = APPEAL["finanzamt"]
    elif office_kind == "sms":
        route = APPEAL["sms"]
    elif office_kind in {"authority", "other"}:
        route = APPEAL["authority"]
    elif spec.benefit_id in PV_BENEFITS or office_kind == "pva":
        route = APPEAL["pv"]
    else:
        route = APPEAL["kv"]
    state = region if region in COURTS else None
    court = COURTS.get(state or "", "zuständigen Landesgericht als Arbeits- und Sozialgericht")
    local = LOCAL_COURTS.get(spec.recipient.locality)
    if local and state != "Wien":
        court = f"Landesgericht {local} als Arbeits- und Sozialgericht"
    return {
        "period": route["period"],
        "period_nom": route["period_nom"],
        "days": route["days"],
        "route": route["route"],
        "court": court,
        "body": route["body"].format(court=court),
        "plain": route["plain"].format(court=court),
        "noun": route["noun"],
        "from": "Zustellung",
    }


def _decision(spec, rng, today, subject, helper, offices, benefits, goal_office) -> bool:
    if not _carrier_issuer(spec, rng, offices, goal_office):
        return False
    office = offices[goal_office]
    kind = DECISION_KINDS.get(spec.benefit_id or "")
    if kind is None:
        return False
    spec.decision_kind = kind
    spec.legal_basis = LEGAL_BASIS.get(spec.benefit_id or "") or CARRIER_LAW.get(
        catalog.office_kind(offices[goal_office]), "Allgemeines Sozialversicherungsgesetz (ASVG)"
    )
    refund = spec.benefit_id in REFUND_BENEFITS
    outcomes = (
        ["approved", "rejected", "partial"]
        if (kind == "level" or refund)
        else ["approved", "rejected"]
    )
    weights = [0.55, 0.25, 0.2] if len(outcomes) == 3 else [0.7, 0.3]
    spec.outcome = rng.choices(outcomes, weights=weights)[0]
    b = spec.benefit_id
    if spec.outcome == "rejected":
        spec.decision_reason = rng.choice(REJECTION_REASONS[kind])
    elif spec.outcome == "partial":
        spec.decision_reason = (
            "Der festgestellte Pflegebedarf entspricht einer niedrigeren als der beantragten Stufe."
            if kind == "level"
            else rng.choice(PARTIAL_REASONS)
        )
    application = today - dt.timedelta(days=rng.randint(21, 70))
    spec.application_date = spec.value(application)
    start = (application.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
    if kind == "level":
        if spec.outcome != "rejected":
            spec.care_level = rng.randint(1, 5)
            _fact(spec, "care_level", "Pflegegeldstufe", f"Stufe {spec.care_level}")
            spec.amount_cents = PFLEGEGELD_CENTS[spec.care_level]
            spec.amount_basis = "monatlich"
            _fact(spec, "amount", "Betrag", fmt_eur(spec.amount_cents))
            spec.treatment_dates = [spec.value(start)]
            _fact(spec, "valid_from", "Ab", spec.treatment_dates[0])
    elif kind == "centre" and spec.outcome != "rejected":
        spec.reha_centre = rng.choice(REHA_CENTRES)
        start = today + dt.timedelta(days=rng.randint(14, 90))
        spec.treatment_dates = [spec.value(start), spec.value(start + dt.timedelta(days=21))]
        _fact(spec, "institution", "Einrichtung", spec.reha_centre)
        _fact(spec, "appointment_date", "Aufnahmetermin", spec.treatment_dates[0])
    elif kind == "exemption" and spec.outcome != "rejected":
        start = (today.replace(day=1) + dt.timedelta(days=32)).replace(day=1)
        end = dt.date(start.year, 12, 31)
        spec.treatment_dates = [spec.value(start), spec.value(end)]
        _fact(spec, "valid_from", "Befreit ab", spec.treatment_dates[0])
        _fact(spec, "valid_until", "Befreit bis", spec.treatment_dates[1])
    elif kind == "approval" and spec.outcome != "rejected" and b == "heilbehelfe-hilfsmittel":
        spec.aid = rng.choice(AIDS)
    elif kind == "amount" and spec.outcome != "rejected":
        lo, hi, basis = AMOUNT_RANGES.get(b or "", (40, 400, "einmalig"))
        spec.amount_cents = rng.randint(lo * 100, hi * 100) // 10 * 10
        if b == "pflege-24-stunden-betreuung":
            spec.amount_cents = rng.choice([80000, 160000])
        spec.amount_basis = basis
        if basis in {"monatlich", "täglich"}:
            spec.treatment_dates = [spec.value(start)]
            _fact(spec, "valid_from", "Ab", spec.treatment_dates[0])
        _fact(spec, "amount", "Betrag", fmt_eur(spec.amount_cents))
    spec.appeal = _appeal(
        spec,
        catalog.office_kind(office),
        office.region or (subject.get("residence") or {}).get("state"),
    )
    return True


def _request(spec, rng, today, subject, helper, offices, benefits, goal_office) -> bool:
    if not _carrier_issuer(spec, rng, offices, goal_office):
        return False
    benefit = benefits.get(spec.goal)
    held = set(subject.get("documents_held") or [])
    if spec.goal in NO_LETTER_BENEFITS:
        return False
    docs = [
        d
        for d in (benefit.documents if benefit else ())
        if d.id not in held and d.id not in NO_REQUEST_DOCS
    ]
    required = [d for d in docs if d.required]
    pool = required + [d for d in docs if not d.required]
    if not pool:
        return False
    k = min(len(pool), rng.randint(1, 3))
    chosen = required[:k] if len(required) >= k else pool[:k]
    spec.requested_documents = [
        {"id": d.id, "name": _clean_doc_name(d.name_de), "obtain_from": d.obtain_from or ""}
        for d in chosen
    ]
    days = (
        rng.choice([14, 14, 21, 28])
        if spec.doc_type == "document_request"
        else rng.choice([7, 10, 14])
    )
    deadline = today + dt.timedelta(days=days)
    while deadline.weekday() >= 5:
        deadline += dt.timedelta(days=1)
    spec.deadline = {"date": spec.value(deadline), "days": days, "iso": deadline.isoformat()}
    _fact(spec, "deadline", "Frist", spec.deadline["date"])
    if spec.doc_type == "reminder":
        prev = today - dt.timedelta(days=rng.randint(21, 45))
        spec.previous_letter_date = spec.value(prev)
    return True


def _invoice(spec, rng, today, subject, helper, offices, benefits, goal_office) -> bool:
    key = (
        spec.goal
        if spec.goal in INVOICE_SPECIALTIES
        else rng.choice(
            [b for b in spec.gold_benefits if b in INVOICE_SPECIALTIES]
            or ["oegk-wahlarzt-kostenerstattung"]
        )
    )
    titles, services = INVOICE_SPECIALTIES[key]
    sex = rng.choice("fm")
    first = rng.choice(FEMALE_FIRST if sex == "f" else MALE_FIRST)
    last = rng.choice(SURNAMES)
    prefix = (
        rng.choice(TITLES_DOCTOR)
        if key in {"oegk-wahlarzt-kostenerstattung", "oegk-zahnbehandlung"}
        else rng.choice(["", "Mag.", "BSc", "MSc"])
    )
    name = f"{prefix + ' ' if prefix and not prefix.startswith(('BSc', 'MSc')) else ''}{first} {last}{', ' + prefix if prefix in {'BSc', 'MSc'} else ''}"
    plz, loc = _locality(
        rng,
        (subject.get("residence") or {}).get("state") or "Wien",
        (subject.get("residence") or {}).get("district"),
    )
    spec.issuer = Issuer(
        name=name,
        lines=[
            titles[0 if sex == "f" else 1],
            f"{rng.choice(STREETS)} {rng.randint(1, 90)}",
            f"{plz} {loc}",
        ],
        phone=f"+43 {rng.randint(660, 699)} {rng.randint(1000000, 9999999)}",
        email=None,
        kind="practice",
        fictional=True,
        signatory=name,
    )
    spec.benefit_id = key
    spec.benefit_name = benefits[key].name_de if key in benefits else None
    n = rng.randint(1, 4)
    items = []
    first_day = today - dt.timedelta(days=7 * (n - 1) + rng.randint(3, 30))
    prices = {sv: rng.randint(45, 260) * 100 + rng.choice([0, 0, 50]) for sv in services}
    for i in range(n):
        day = first_day + dt.timedelta(days=7 * i)
        while day.weekday() >= 5:
            day += dt.timedelta(days=1)
        service = services[0] if i == 0 or len(services) == 1 else rng.choice(services[1:])
        cents = prices[service]
        items.append(
            {
                "date": spec.value(day),
                "service": service,
                "cents": cents,
                "amount": fmt_eur(cents),
            }
        )
    spec.invoice_items = items
    spec.treatment_dates = [it["date"] for it in items]
    spec.amount_cents = sum(it["cents"] for it in items)
    spec.reference = f"{today.year}-{rng.randint(1, 999):03d}"
    spec.reference_label = rng.choice(["Honorarnote Nr.", "Rechnung Nr.", "Rechnungsnummer"])
    spec.layout["paid"] = rng.random() < 0.8
    _fact(spec, "institution", "Ordination", name)
    _fact(spec, "case_number", spec.reference_label, spec.reference)
    _fact(spec, "document_date", "Rechnungsdatum", spec.letter_date)
    _fact(spec, "amount", "Gesamtbetrag", fmt_eur(spec.amount_cents))
    _fact(spec, "insurance_number", "Versicherungsnummer", spec.patient.insurance_number)
    if cv := _carrier_fact_value(spec):
        _fact(spec, "carrier", "Versicherung", cv)
    for it in items:
        _fact(spec, "visit_date", "Behandlungsdatum", it["date"])
    return True


def _prescription(spec, rng, today, subject, helper, offices, benefits, goal_office) -> bool:
    sex = rng.choice("fm")
    first = rng.choice(FEMALE_FIRST if sex == "f" else MALE_FIRST)
    plz, loc = _locality(
        rng,
        (subject.get("residence") or {}).get("state") or "Wien",
        (subject.get("residence") or {}).get("district"),
    )
    name = f"{rng.choice(TITLES_DOCTOR)} {first} {rng.choice(SURNAMES)}"
    spec.issuer = Issuer(
        name=name,
        lines=[
            rng.choice(
                [
                    "Ärztin für Allgemeinmedizin",
                    "Arzt für Allgemeinmedizin",
                    "Fachärztin für Innere Medizin",
                    "Facharzt für Orthopädie",
                ]
            ),
            f"{rng.choice(STREETS)} {rng.randint(1, 90)}",
            f"{plz} {loc}",
        ],
        phone=f"+43 {rng.randint(2600, 7999)} {rng.randint(10000, 99999)}",
        email=None,
        kind="practice",
        fictional=True,
        signatory=name,
    )
    kind = (
        "aid"
        if spec.scenario == "aids_and_devices" or spec.goal == "heilbehelfe-hilfsmittel"
        else ("therapy" if spec.scenario == "therapy_after_illness" else "medicine")
    )
    spec.prescription_kind = kind
    spec.reference = f"{rng.randint(1000000, 9999999)}"
    spec.reference_label = "Rezept-Nr."
    _fact(spec, "institution", "Verordnende Stelle", name)
    _fact(spec, "document_date", "Ausstellungsdatum", spec.letter_date)
    _fact(spec, "insurance_number", "VSNR", spec.patient.insurance_number)
    if cv := _carrier_fact_value(spec):
        _fact(spec, "carrier", "Krankenversicherungsträger", cv)
    if kind == "aid":
        spec.aid = rng.choice(AIDS)
        spec.medicines = [{"name": spec.aid, "strength": "1 Stück", "schema": "Heilbehelf"}]
    elif kind == "therapy":
        therapy = rng.choice(["Physiotherapie", "Ergotherapie", "Logopädie"])
        spec.medicines = [
            {
                "name": therapy,
                "strength": f"{rng.choice([6, 8, 10, 12])} Einheiten",
                "schema": "Heilmittel",
            }
        ]
    else:
        meds = rng.sample(MEDICINES, rng.randint(1, 3))
        spec.medicines = [{"name": n, "strength": s, "schema": sch} for n, s, sch in meds]
    return True
