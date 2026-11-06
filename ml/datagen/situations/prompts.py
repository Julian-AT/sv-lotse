"""Prompt for naturalising a persona's situation text (the LLM writes surface text only)."""

from __future__ import annotations

import hashlib
import json

from ..config import default

CARRIERS = {"oegk": "ÖGK", "svs": "SVS", "bvaeb": "BVAEB"}
PENSION = {"pva": "PVA", "svs": "SVS", "bvaeb": "BVAEB"}
EMPLOYMENT = {
    "employed": "employed",
    "marginal_employment": "marginally employed (geringfügig)",
    "self_employed": "self-employed",
    "farmer": "farmer",
    "civil_servant": "civil servant",
    "retired": "retired",
    "unemployed": "unemployed",
    "student": "student",
    "homemaker": "homemaker, co-insured through the partner",
    "parental_leave": "on parental leave",
    "none": "no insurance and no job",
}
INCOME = {
    "lt_1300": "under 1,300 EUR",
    "1300_2000": "1,300-2,000 EUR",
    "2000_3000": "2,000-3,000 EUR",
    "gt_3000": "over 3,000 EUR",
}
NEEDS = {
    "mobility": "walking/moving",
    "household": "household chores",
    "personal_care": "washing and dressing",
    "medication": "taking medication",
    "supervision": "cannot be left alone",
    "meals": "cooking and eating",
}
SEX = {"f": "woman", "m": "man", "d": "non-binary person"}

DIALECT_BY_STATE = {
    "Wien": "Viennese (Wienerisch)",
    "Niederösterreich": "Lower Austrian colloquial",
    "Burgenland": "Burgenland colloquial",
    "Steiermark": "Styrian (Steirisch)",
    "Kärnten": "Carinthian (Kärntnerisch)",
    "Oberösterreich": "Upper Austrian (Mühlviertel etc.)",
    "Salzburg": "Salzburg colloquial",
    "Tirol": "Tyrolean (Tirolerisch)",
    "Vorarlberg": "Vorarlberg Alemannic (Vorarlbergerisch), moderately readable",
}

LANG_INSTRUCTIONS = {
    "de": "Austrian Standard German as an Austrian resident writes it (Austrian words such as "
    "Spital, Jänner, Ordination are fine).",
    "de-AT-dialect": "Austrian colloquial German / dialect as typed in a chat: {dialect}. Keep it "
    "readable for other Austrians.",
    "de-easy": "German in plain language (Einfache Sprache, CEFR B1): short sentences, common "
    "words, one idea per sentence, no jargon.",
    "en": "English, as written by an English-speaking resident of Austria (Austrian place names "
    "stay as they are).",
    "tr": "Turkish, as written by a Turkish-speaking resident of Austria (a few German words such "
    "as e-card or Termin are natural).",
    "bcs": "{bcs} in Latin script, as written by a resident of Austria from the BCS diaspora "
    "(a few German words are natural).",
    "ro": "Romanian, as written by a Romanian-speaking resident of Austria.",
    "hu": "Hungarian, as written by a Hungarian-speaking resident of Austria.",
    "pl": "Polish, as written by a Polish-speaking resident of Austria.",
    "uk": "Ukrainian (Cyrillic), as written by a Ukrainian resident of Austria (e.g. displaced "
    "since 2022).",
    "ar": "Arabic script, Modern Standard Arabic with light colloquial (Syrian/Iraqi/Egyptian) "
    "touches, as written by an Arabic-speaking resident of Austria.",
}
BCS = ("Bosnian", "Croatian", "Serbian")
LANG_NAME = {
    "de": "German (Austrian)",
    "de-AT-dialect": "Austrian dialect German",
    "de-easy": "German, plain language B1",
    "en": "English",
    "tr": "Turkish (Türkçe)",
    "bcs": "{bcs}",
    "ro": "Romanian (română)",
    "hu": "Hungarian (magyar)",
    "pl": "Polish (polski)",
    "uk": "Ukrainian (українська)",
    "ar": "Arabic (العربية)",
}

STYLE = {
    "plain": "a plain chat message",
    "question_first": "a chat message that opens with the question, then gives the background",
    "story": "a chat message that tells what happened first, then asks",
    "chatty": "a chatty, rambling message with small talk",
    "telegraphic": "a terse, telegraphic message (fragments, few words)",
    "formal_letter": "a short formal letter/e-mail with salutation and closing",
}
LITERACY = {
    "low": "low literacy: very simple words, short or run-on sentences, some spelling mistakes "
    "and missing punctuation",
    "medium": "average literacy: everyday language, occasional small mistakes",
    "high": "high literacy: clear, well-formed sentences",
}
REGISTER = {
    "formal": "formal (Sie-form or equivalent)",
    "neutral": "neutral",
    "colloquial": "colloquial",
    "dialect": "strongly colloquial",
}

SYSTEM = """You write realistic opening messages that people in Austria send to a free assistant \
that helps them find out which social-insurance and social benefits might apply to them and how \
to apply. You get a persona card and a reference message (template-generated, same person, same \
concern). Write a NEW message, as the speaker, in the requested language, variant, style, \
register and literacy level.

Hard rules:
1. Use only facts from the card. Never invent facts (no new illnesses, amounts, dates, names, \
diagnoses, family members). You may leave facts out.
2. Never name any benefit, allowance, payment, programme, leave scheme, authority, office or \
form (for example no "Pflegegeld", "Kinderbetreuungsgeld", "Wochengeld", "Rehabilitation", \
"Sozialhilfe", "AMS", "Sozialministeriumservice", "Magistrat", "BH"). Describe the situation and \
the need instead; the assistant must work out the benefits. The insurer short name from the card \
(e.g. ÖGK, SVS, BVAEB, PVA) may be mentioned.
3. Keep the speaker's concern from the reference message, but phrase it freshly; do not translate \
the reference literally.
4. No personal names, phone numbers, addresses, e-mails or exact birth dates.
5. Money only as the card's range or one of its bounds (e.g. "under 1,300 euros", \
"about 2,000"), never another amount.
6. Write in the requested output language, even though the reference message is in another \
language.
7. 15 to 160 words. Output JSON: {"text": "<the message>"}."""


def variant_for(pid: str) -> tuple[str, str | None]:
    """(language code from config, sub-variant) chosen deterministically by persona id."""
    langs = default().languages
    h = int(hashlib.sha256(f"lang:{pid}".encode()).hexdigest()[:12], 16) / 16**12
    acc = 0.0
    code = langs[-1]["code"]
    for lang in langs:
        acc += lang["share"]
        if h < acc:
            code = lang["code"]
            break
    sub = None
    if code == "bcs":
        sub = BCS[int(hashlib.sha256(f"bcs:{pid}".encode()).hexdigest()[:8], 16) % 3]
    return code, sub


CARD_LANGUAGE = {"de": "de-AT", "de-AT-dialect": "de-AT", "de-easy": "de-AT", "bcs": None}
BCS_CODE = {"Bosnian": "bs", "Croatian": "hr", "Serbian": "sr"}


def card_language(code: str, sub: str | None) -> str:
    if code == "bcs":
        return BCS_CODE[sub or "Croatian"]
    return CARD_LANGUAGE.get(code) or code


def describe_member(m: dict, docs: dict[str, str]) -> list[str]:
    ins = m["insurance"]
    out = [
        f"age {m['age']}, {SEX.get(m['sex'], m['sex'])}",
        f"lives in {m['residence']['state']}"
        + (f", district {m['residence']['district']}" if m["residence"]["district"] else ""),
        f"work: {EMPLOYMENT.get(m['employment'], m['employment'])}",
    ]
    if ins["carrier"]:
        out.append(f"health insurer: {CARRIERS.get(ins['carrier'], ins['carrier'])}")
    else:
        out.append("no health insurance")
    if ins["pension_carrier"]:
        out.append(f"pension paid by {PENSION.get(ins['pension_carrier'], ins['pension_carrier'])}")
    out.append(f"net income per month: {INCOME.get(m['income_band'], m['income_band'])}")
    care = m.get("care") or {}
    if care.get("needs"):
        out.append("needs help with: " + ", ".join(NEEDS.get(n, n) for n in care["needs"]))
    if care.get("pflegegeld_level"):
        out.append(f"already has an official care level {care['pflegegeld_level']} (Pflegestufe)")
    if m.get("children"):
        out.append("children aged " + ", ".join(str(c["age"]) for c in m["children"]))
    held = [docs.get(d, d) for d in m.get("documents_held") or [] if d != "e-card"]
    if held:
        out.append("papers at hand: " + "; ".join(held[:4]))
    return out


def build_messages(
    row: dict, household: list[dict], noise: dict, code: str, sub: str | None, docs: dict[str, str]
) -> list[dict]:
    subject = next(m for m in household if m["role"] == "subject")
    helper = next((m for m in household if m["role"] == "helper"), None)
    speaker = helper or subject
    lang = LANG_INSTRUCTIONS[code].format(
        dialect=DIALECT_BY_STATE.get(subject["residence"]["state"], "Austrian colloquial"),
        bcs=sub or "Croatian",
    )
    card = {
        "speaker": (
            "a relative or acquaintance (see reference message for the relation) "
            "writing about the subject"
            if helper
            else "the subject, about themself"
        ),
        "subject": describe_member(subject, docs),
    }
    if helper:
        card["speaker_details"] = [
            f"age {helper['age']}",
            f"lives in {helper['residence']['state']}",
        ]
    register = "dialect" if code == "de-AT-dialect" else speaker["register"]
    if register == "dialect" and code != "de-AT-dialect":
        register = "colloquial"
    noise_txt = []
    if noise.get("partial_knowledge", 0) >= 0.2:
        noise_txt.append(
            "the speaker is unsure about or forgets some details (e.g. the insurer or "
            "the exact level); leave a few card facts out"
        )
    if noise.get("contradiction", 0) >= 0.15:
        noise_txt.append(
            "include one small self-correction that ends with the card's fact "
            "(e.g. 'she is 80, no, 82')"
        )
    user = {
        "persona_id": row["id"],
        "language": lang,
        "style": STYLE.get(row["style"], row["style"]),
        "register": REGISTER.get(register, register),
        "literacy": LITERACY.get(speaker["literacy"], speaker["literacy"]),
        "noise": noise_txt or ["none"],
        "card": card,
        "reference_message": row["situation_text"],
        "output_language": LANG_NAME[code].format(bcs=sub or "Croatian"),
    }
    return [
        {"role": "system", "content": SYSTEM},
        {
            "role": "user",
            "content": json.dumps(user, ensure_ascii=False, indent=1)
            + f"\n\nWrite the message in {user['output_language']}.",
        },
    ]
