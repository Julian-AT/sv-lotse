"""Candidate fact mapping for the flat E13 forms (dataset-side, not a product mapping).

The product never infers a mapping from a label; detected fields without a reviewed mapping get
an instance-independent `form.field.<template>.<field>` fact type and stay missing. For the
dataset we add a conservative, rule-based candidate mapping for the subject's own administrative
identity fields only (name parts, birth date, insurance number, address, contact, IBAN, date of
application). Everything else (relatives, lease tables, spouses, farm data, all checkboxes,
clinical or office sections, signatures) stays unmapped, exactly like an unreviewed template.
Each gold field records `mapping: "candidate"` so users can drop these rows.
"""

from __future__ import annotations

import re

# Sections that describe the applicant/insured person themself.
SUBJECT_SECTIONS = re.compile(
    r"^(Antragsteller|Antragsteller \(implicit\)|Antragsteller\(in\)|Daten des Antragstellers"
    r"|Daten der anzumeldenden Person|Daten der abzumeldenden Person|Versicherte\(r\)"
    r"|VOLLMACHTGEBENDE PERSON|Bankverbindung|Unterfertigung|Wahrheitsgemäße Erklärung)"
)
REPRESENTATIVE_SECTIONS = re.compile(r"^BEVOLLMÄCHTIGTE PERSON")

SUBJECT_RULES: list[tuple[str, str, str]] = [
    # (label regex, field type, fact type)
    (r"^(Versicherungsnummer|VSNR/Geburtsdatum)$", "text", "person.insurance_number"),
    (
        r"^(Titel, Familienname, Vorname|Familienname, Vorname)( \(hauptversichert\))?$",
        "text",
        "person.name_family_first",
    ),
    (r"^Familien- und Vorname$", "text", "person.name_family_first"),
    (r"^Familienname, Titel$", "text", "person.family_name_title"),
    (r"^(Familienname|Familien- oder Nachname)$", "text", "person.family_name"),
    (r"^Vorname$", "text", "person.given_name"),
    (r"^Titel$", "text", "person.title"),
    (r"^Name$", "text", "person.name"),
    (r"^Frühere\(r\) Name\(n\)$", "text", "person.previous_names"),
    (r"^Geburtsdatum( \(TT/MM/JJJJ\))?$", "date", "person.birth_date"),
    (r"^(Telefon|Telefonnummer)$", "text", "contact.phone"),
    (r"^(E-Mail|E-Mail Adresse)$", "text", "contact.email"),
    (r"^(Wohnanschrift|Adresse|Anschrift)$", "text", "address.full"),
    (r"^Postleitzahl$", "text", "address.postcode"),
    (r"^Wohnort$", "text", "address.city"),
    (r"^IBAN$", "text", "bank.iban"),
    (r"^Geldinstitut$", "text", "bank.name"),
    # "Ort/Datum" fields also need a place; a date-typed fact cannot fill them, so they stay
    # unmapped.
    (r"^(Datum|Datum \(TT/MM/JJJJ\))$", "date", "application.date"),
]
REPRESENTATIVE_RULES: list[tuple[str, str, str]] = [
    (r"^(Familienname|Familien- oder Nachname)$", "text", "representative.family_name"),
    (r"^Vorname$", "text", "representative.given_name"),
    (r"^(Telefon|Telefonnummer)$", "text", "representative.phone"),
    (r"^(E-Mail|E-Mail Adresse)$", "text", "representative.email"),
    (r"^(Wohnanschrift|Adresse|Anschrift)$", "text", "representative.address"),
]


def fact_type_for(label: str, section: str, ftype: str, owner: str) -> str | None:
    if owner != "applicant" or ftype in ("checkbox", "signature"):
        return None
    if SUBJECT_SECTIONS.match(section):
        rules = SUBJECT_RULES
    elif REPRESENTATIVE_SECTIONS.match(section):
        rules = REPRESENTATIVE_RULES
    else:
        return None
    for pattern, expected_type, fact in rules:
        if expected_type == ftype and re.match(pattern, label.strip()):
            return fact
    return None
