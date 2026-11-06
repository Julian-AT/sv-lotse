"""Persona slots: reading values from a persona card, detecting which slots a question asks for,
rendering simulated answers and oracle questions in German, English and Turkish.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

# Persona slot -> path inside the speaking household member (§5.2 schema).
SLOT_PATHS: dict[str, tuple[str, ...]] = {
    "residence_state": ("residence", "state"),
    "residence_district": ("residence", "district"),
    "age": ("age",),
    "insurance_carrier": ("insurance", "carrier"),
    "insurance_status": ("insurance", "status"),
    "pension_carrier": ("insurance", "pension_carrier"),
    "employment": ("employment",),
    "income_band": ("income_band",),
    "pflegegeld_level": ("care", "pflegegeld_level"),
    "care_needs": ("care", "needs"),
    "children": ("children",),
    "documents_held": ("documents_held",),
}

# Order matters: more specific slots first, so "Pflegegeldstufe" is not read as care needs.
SLOT_PATTERNS: dict[str, str] = {
    "pflegegeld_level": (
        r"pflege(geld)?stufe|care (allowance )?level|bakım (parası )?(seviye|derece)"
    ),
    "pension_carrier": (
        r"pensionsversicherung|pensionsträger|pension .*(träger|stelle|bescheid)|"
        r"pension carrier|pension (insurance|fund)|which .*pension|emekli(lik)? (kurum|sandı)"
    ),
    "insurance_carrier": (
        r"krankenkasse|krankenversichert|versichert|versicherungsträger|"
        r"health insurer|insured|insurance carrier|sigorta"
    ),
    "insurance_status": (
        r"versicherungsstatus|pensionist|in pension|status|retired|pensioner|emekli misiniz|statü"
    ),
    "residence_district": r"bezirk|district|ilçe",
    "residence_state": (
        r"bundesland|wo (wohn|leb)|wohnort|wohnen sie|which (federal )?state|province|"
        r"where .*(live|reside)|hangi (eyalet|il)|nerede (yaşı|otur)"
    ),
    "age": r"wie alt|alter\b|how old|\bage\b|kaç yaşında|yaşı kaç|yaşınız",
    "employment": r"berufstätig|beschäftigt|arbeiten sie|erwerbs|employ|working|\bjob\b|çalışıyor",
    "income_band": r"einkommen|verdien|income|earn|gelir",
    "children": r"kinder|children|kids|çocuk",
    "care_needs": r"hilfe bei|unterstützung bei|pflegebedarf|help with|support with|yardım",
    "documents_held": r"unterlagen|dokumente|befund|documents|paperwork|belge",
}
_COMPILED = {slot: re.compile(p, re.IGNORECASE) for slot, p in SLOT_PATTERNS.items()}

# Engine (process YAML) slot ids -> persona slots. Unmapped ids stay engine-only slots.
ENGINE_SLOT_MAP: dict[str, str] = {
    "residence_region": "residence_state",
    "region": "residence_state",
    "state": "residence_state",
    "district": "residence_district",
    "pension_source": "pension_carrier",
    "pension_carrier": "pension_carrier",
    "carrier": "insurance_carrier",
    "insurance_carrier": "insurance_carrier",
    "subjectStatus": "insurance_status",
    "subject_status": "insurance_status",
    "insurance_status": "insurance_status",
    "age": "age",
    "age_band": "age",
    "employment": "employment",
    "income": "income_band",
    "income_band": "income_band",
    "care_level": "pflegegeld_level",
    "pflegegeld_level": "pflegegeld_level",
    "awarded_level": "pflegegeld_level",
    "children": "children",
}

# office.resolve needs carrier, subject status and region (contract in brain tools/contracts).
OFFICE_CONTEXT_SLOTS = ("residence_state", "insurance_carrier", "insurance_status")

# Plausible wrong values for contradiction noise (first stated, then corrected).
ALTERNATIVES: dict[str, tuple[str, ...]] = {
    "residence_state": ("Wien", "Niederösterreich", "Oberösterreich", "Steiermark", "Tirol"),
    "insurance_carrier": ("OEGK", "BVAEB", "SVS"),
    "pension_carrier": ("PVA", "SVS", "BVAEB"),
}

CARRIER_NAMES = {
    "OEGK": "ÖGK",
    "BVAEB": "BVAEB",
    "SVS": "SVS",
    "PVA": "PVA",
    "AUVA": "AUVA",
}


_ALIAS_TARGETS = {
    "region": "residence_state",
    "carrier": "insurance_carrier",
    "subjectStatus": "insurance_status",
}


def map_engine_slot(slot_id: str) -> str:
    """Engine slot id -> persona slot, using the product's office-context aliases as well."""
    if slot_id in ENGINE_SLOT_MAP:
        return ENGINE_SLOT_MAP[slot_id]
    from gym.world import office_context

    for key, target in _ALIAS_TARGETS.items():
        if slot_id in office_context().get("aliases", {}).get(key, []):
            return target
    return slot_id


def speaker(persona: dict[str, Any]) -> dict[str, Any]:
    """The household member who talks to the agent: the helper if present, else the subject."""
    household = persona.get("household") or [{}]
    for member in household:
        if member.get("role") == "helper":
            return member
    return household[0]


def subject(persona: dict[str, Any]) -> dict[str, Any]:
    household = persona.get("household") or [{}]
    for member in household:
        if member.get("role") == "subject":
            return member
    return household[0]


def language(persona: dict[str, Any]) -> str:
    lang = str(
        persona.get("text_language")
        or persona.get("language")
        or speaker(persona).get("language")
        or "de-AT"
    )
    return lang.split("-")[0].lower()


def slot_value(persona: dict[str, Any], slot: str) -> Any:
    node: Any = subject(persona)
    for key in SLOT_PATHS.get(slot, (slot,)):
        if not isinstance(node, dict) or key not in node:
            return None
        node = node[key]
    return node


def persona_slots(persona: dict[str, Any]) -> dict[str, Any]:
    return {slot: slot_value(persona, slot) for slot in SLOT_PATHS}


def detect_slots(question: str) -> list[str]:
    """Slots a question asks for, most specific first. A process question hint quoted verbatim
    maps to its engine slot (persona slot when mapped)."""
    from gym.world import slot_hints

    for slot_id, hint in slot_hints().items():
        stem = hint.split("?")[0].strip()
        if len(stem) > 12 and stem in question:
            return [map_engine_slot(slot_id)]
    found: list[str] = []
    for slot, pattern in _COMPILED.items():
        if pattern.search(question) and slot not in found:
            found.append(slot)
    if "pflegegeld_level" in found and "care_needs" in found:
        found.remove("care_needs")
    if "pension_carrier" in found and "insurance_status" in found:
        found.remove("insurance_status")
    if "pension_carrier" in found and "insurance_carrier" in found:
        found.remove("insurance_carrier")
    return found


_URL = re.compile(r"https?://\S+")


def is_question(text: str) -> bool:
    """A message asks something when it has a question mark outside URLs."""
    return "?" in _URL.sub(" ", text)


def _fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()


def display_value(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(display_value(v) for v in value) if value else "-"
    if value is None:
        return "-"
    return CARRIER_NAMES.get(str(value), str(value))


def mentioned(text: str, value: Any) -> bool:
    """Whether a slot value is stated in free text (accent-insensitive)."""
    if value is None or value == [] or isinstance(value, bool):
        return False
    if isinstance(value, list):
        return all(mentioned(text, v) for v in value)
    folded = _fold(text)
    candidates = {str(value), display_value(value)}
    return any(
        len(c) >= 2 and re.search(rf"(?<!\w){re.escape(_fold(c))}(?!\w)", folded)
        for c in candidates
    )


def known_from_text(persona: dict[str, Any], text: str) -> set[str]:
    return {slot for slot, value in persona_slots(persona).items() if mentioned(text, value)}


ANSWERS: dict[str, dict[str, str]] = {
    "de": {
        "residence_state": "Wir wohnen in {v}.",
        "residence_district": "Im Bezirk {v}.",
        "age": "{v} Jahre.",
        "insurance_carrier": "Versichert bei der {v}.",
        "insurance_status": "Status: {v}.",
        "pension_carrier": "Die Pension kommt von der {v}.",
        "employment": "Beschäftigung: {v}.",
        "income_band": "Einkommen: {v}.",
        "pflegegeld_level": "Pflegegeldstufe: {v}.",
        "care_needs": "Hilfe brauchen wir bei: {v}.",
        "children": "Kinder: {v}.",
        "documents_held": "Wir haben: {v}.",
        "_unknown": "Das weiß ich leider nicht genau.",
        "_none": "Dazu kann ich nichts sagen.",
    },
    "en": {
        "residence_state": "We live in {v}.",
        "residence_district": "In the district of {v}.",
        "age": "{v} years old.",
        "insurance_carrier": "Insured with {v}.",
        "insurance_status": "Status: {v}.",
        "pension_carrier": "The pension comes from {v}.",
        "employment": "Employment: {v}.",
        "income_band": "Income: {v}.",
        "pflegegeld_level": "Care allowance level: {v}.",
        "care_needs": "We need help with: {v}.",
        "children": "Children: {v}.",
        "documents_held": "We have: {v}.",
        "_unknown": "I am not sure about that.",
        "_none": "I can't say anything about that.",
    },
    "tr": {
        "residence_state": "{v} eyaletinde yaşıyoruz.",
        "residence_district": "{v} ilçesinde.",
        "age": "{v} yaşında.",
        "insurance_carrier": "{v} sigortalıyız.",
        "insurance_status": "Durum: {v}.",
        "pension_carrier": "Emekli maaşı {v} kurumundan geliyor.",
        "employment": "Çalışma durumu: {v}.",
        "income_band": "Gelir: {v}.",
        "pflegegeld_level": "Bakım parası seviyesi: {v}.",
        "care_needs": "Şu konularda yardım lazım: {v}.",
        "children": "Çocuklar: {v}.",
        "documents_held": "Elimizde olanlar: {v}.",
        "_unknown": "Bunu tam bilmiyorum.",
        "_none": "Bu konuda bir şey söyleyemem.",
    },
}

QUESTIONS: dict[str, dict[str, str]] = {
    "de": {
        "residence_state": "In welchem Bundesland wohnt die Person?",
        "residence_district": "In welchem Bezirk wohnt die Person?",
        "age": "Wie alt ist die Person?",
        "insurance_carrier": "Bei welcher Krankenkasse ist die Person versichert?",
        "insurance_status": "Welchen Versicherungsstatus hat die Person, etwa Pensionist?",
        "pension_carrier": "Von welchem Pensionsträger kommt die Pension laut Bescheid?",
        "employment": "Ist die Person derzeit berufstätig?",
        "income_band": "Wie hoch ist das monatliche Einkommen ungefähr?",
        "pflegegeld_level": "Gibt es bereits eine Pflegegeldstufe?",
        "care_needs": "Bei welchen Tätigkeiten braucht die Person Hilfe bei der Pflege?",
        "children": "Leben Kinder im Haushalt?",
        "documents_held": "Welche Unterlagen liegen Ihnen schon vor?",
    },
    "en": {
        "residence_state": "Which federal state does the person live in?",
        "residence_district": "Which district does the person live in?",
        "age": "How old is the person?",
        "insurance_carrier": "Which health insurer is the person insured with?",
        "insurance_status": "What is the person's insurance status, for example pensioner?",
        "pension_carrier": "Which pension carrier pays the pension according to the notice?",
        "employment": "Is the person currently working in a job?",
        "income_band": "Roughly what is the monthly income?",
        "pflegegeld_level": "Is there already a care allowance level?",
        "care_needs": "What does the person need help with?",
        "children": "Are there children in the household?",
        "documents_held": "Which documents do you already have?",
    },
    "tr": {
        "residence_state": "Kişi hangi eyalette yaşıyor?",
        "residence_district": "Kişi hangi ilçede yaşıyor?",
        "age": "Kişi kaç yaşında?",
        "insurance_carrier": "Kişi hangi sigorta kurumunda sigortalı?",
        "insurance_status": "Kişinin statü bilgisi nedir, örneğin emekli mi?",
        "pension_carrier": "Emekli maaşını hangi emeklilik kurumu ödüyor?",
        "employment": "Kişi şu anda çalışıyor mu?",
        "income_band": "Aylık gelir yaklaşık ne kadar?",
        "pflegegeld_level": "Mevcut bir bakım parası seviyesi var mı?",
        "care_needs": "Kişinin hangi konularda yardıma ihtiyacı var?",
        "children": "Hanede çocuk yaşıyor mu?",
        "documents_held": "Hangi belgeler elinizde mevcut?",
    },
}


def question_for(slot: str, lang: str) -> str:
    return QUESTIONS.get(lang, QUESTIONS["de"])[slot]


def answer_for(slot: str, value: Any, lang: str) -> str:
    table = ANSWERS.get(lang, ANSWERS["de"])
    if slot == "children" and isinstance(value, list):
        ages = [c.get("age") for c in value if isinstance(c, dict) and c.get("age") is not None]
        value = f"{len(value)} ({', '.join(map(str, ages))})" if ages else len(value)
    if value is None or value == []:
        return table["_none"]
    return table[slot].format(v=display_value(value))
