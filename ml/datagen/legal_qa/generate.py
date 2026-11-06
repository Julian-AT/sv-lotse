"""Question generation per RIS section: slot plan, prompt, structured output."""

from __future__ import annotations

import hashlib
import random

from pydantic import BaseModel, Field

from datagen.legal_qa.corpus import Section, truncate

# Target language mix (German majority: 52 %). Codes follow datagen/config.yaml.
LANGUAGES = {
    "de": 0.36,
    "de-easy": 0.08,
    "de-AT-dialect": 0.08,
    "en": 0.08,
    "tr": 0.07,
    "bcs": 0.07,
    "ro": 0.05,
    "hu": 0.04,
    "pl": 0.05,
    "uk": 0.05,
    "ar": 0.07,
}
LANGUAGE_NAMES = {
    "de": "German (Austrian standard)",
    "de-easy": "German in plain language (Leichte/Einfache Sprache, B1: short sentences, "
    "everyday words)",
    "de-AT-dialect": "German, colloquial Austrian (umgangssprachlich, Austrian words such as "
    "'Pension', 'Krankenstand', 'heuer'; light dialect allowed, still readable)",
    "en": "English",
    "tr": "Turkish",
    "bcs": "Bosnian/Croatian/Serbian (Latin script)",
    "ro": "Romanian",
    "hu": "Hungarian",
    "pl": "Polish",
    "uk": "Ukrainian (Cyrillic)",
    "ar": "Arabic (Modern Standard Arabic)",
}
DIFFICULTY = {"easy": 0.35, "medium": 0.4, "hard": 0.25}
DIFFICULTY_TEXT = {
    "easy": "asks for one fact stated directly in one Absatz (who, what, which deadline, which "
    "amount), phrased in the asker's own words",
    "medium": "needs a condition or exception of the section, or combines two statements of it; "
    "phrased as a concrete situation or a how/when question",
    "hard": "a realistic case description (a person, a situation, numbers or dates) where the "
    "answer follows from applying the section's rules; must not name the rule",
}
STYLES = ("formal", "plain", "colloquial")
STYLE_TEXT = {
    "formal": "complete, polite question as in a letter or e-mail to an office",
    "plain": "very simple: one or two short sentences, common words, no legal terms",
    "colloquial": "spoken everyday register as typed into a chat or said aloud: informal, may "
    "start with personal context, contractions and small slips allowed",
}
DIALECT = (
    " For this slot write clearly colloquial Austrian German (for example 'Is des so, dass…', "
    "'kriag i', 'mei Mama', 'heuer', 'Pension', 'beim Amt'), still understandable."
)


class Question(BaseModel):
    slot: int
    question: str = Field(description="The question in the slot's language and style")
    question_de: str = Field(description="Faithful German rendering of the question")
    answer: str = Field(description="Short answer in the slot's language, from the section only")
    absatz: list[str] = Field(description="Absatz numbers the answer relies on, e.g. ['2']")
    evidence_quote: str = Field(description="Verbatim German quote from the section, max 30 words")


class Generation(BaseModel):
    usable: bool = Field(description="false if the section has no askable content")
    questions: list[Question]


def n_questions(section: Section) -> int:
    n = len(section.text)
    return 1 if n < 500 else 2 if n < 1500 else 3 if n < 4000 else 4


def _weighted(rng: random.Random, table: dict[str, float]) -> str:
    return rng.choices(list(table), weights=list(table.values()))[0]


def slot_plan(section: Section, tranche: int) -> list[dict]:
    seed = int(hashlib.sha256(f"{section.doc_id}:{tranche}".encode()).hexdigest()[:12], 16)
    rng = random.Random(seed)
    slots = []
    for k in range(n_questions(section)):
        lang = _weighted(rng, LANGUAGES)
        if lang == "de-easy":
            style = "plain"
        elif lang == "de-AT-dialect":
            style = "colloquial"
        elif lang == "de":
            style = "formal"
        else:
            style = rng.choices(STYLES, weights=[0.5, 0.25, 0.25])[0]
        slots.append(
            {"slot": k, "language": lang, "style": style, "difficulty": _weighted(rng, DIFFICULTY)}
        )
    # Prefer one easy question per section so every section has a direct lookup query.
    if slots and all(s["difficulty"] != "easy" for s in slots) and rng.random() < 0.5:
        slots[0]["difficulty"] = "easy"
    return slots


SYSTEM = """You write search queries for training and evaluating a retrieval system over \
Austrian social-insurance law (RIS, consolidated federal law). You get ONE law section and a \
list of question slots. For each slot write one question that a real person (insured person, \
relative, pensioner, farmer, self-employed, caseworker) would type or say, in the slot's \
language, style and difficulty.

Hard rules for every question:
1. The section alone fully answers it; the answer is correct according to the section text.
2. Self-contained: a reader who has NOT seen the section must know exactly what is asked. Name \
the subject explicitly (which benefit, which insurance, which group of people, which amount or \
deadline, which year). Never write "this/these/the mentioned/the new rule/the changes/such a \
case" or similar references to unseen context.
3. If the rule applies only to a specific group or situation, the question states that group or \
situation (for example "als Bäuerin mit Betrieb ab 1. Jänner 2026", "Beamte in der \
Unfallversicherung").
4. Specific to this section: prefer its distinctive content (conditions, deadlines, amounts, \
carriers, exceptions), not a general rule that other sections also state.
5. Never quote the section: at most 4 consecutive words may match the section text (fixed legal \
terms such as "Ausgleichszulage" are fine). Paraphrase with everyday words.
6. Never mention a paragraph number, "§", "Absatz", "Ziffer", the law's name or abbreviation \
(ASVG, GSVG, BSVG, B-KUVG, ...).
7. No medical advice and no diagnoses; administrative and legal content only.
8. Styles: formal = complete, polite question; plain = short simple sentences, common words; \
colloquial = how people talk (may be informal, contain small talk or minor typos, still clear).
9. Answer: 1-3 sentences in the slot's language, only from the section, complete for what is \
asked, including the conditions or exceptions of the section that matter for the question. \
absatz: the Absatz numbers used (empty list if the section has no numbered Absätze). \
evidence_quote: an exact German quote from the section (max 30 words) supporting the answer. \
question_de: a faithful German rendering of the question (for German slots: the question itself).
Set usable=false and return no questions if the section is purely technical (for example only \
in-force dates of amendments identified by Bundesgesetzblatt numbers, a pure cross-reference, or \
internal administration) so that no self-contained question a real person would ask is possible; \
otherwise fill every slot."""
PROMPT_VERSION = "v3"


def messages(section: Section, slots: list[dict]) -> list[dict]:
    slot_lines = "\n".join(
        f"- slot {s['slot']}: language = {LANGUAGE_NAMES[s['language']]}; style = {s['style']} "
        f"({STYLE_TEXT[s['style']]}); difficulty = {s['difficulty']} "
        f"({DIFFICULTY_TEXT[s['difficulty']]}){DIALECT if s['language'] == 'de-AT-dialect' else ''}"
        for s in slots
    )
    absatz = ", ".join(section.absaetze) if section.absaetze else "none"
    user = (
        f"Law: {section.act_title} ({section.act})\nSection: {section.paragraph}"
        f"{' – ' + section.title if section.title else ''}\nNumbered Absätze: {absatz}\n\n"
        f"Section text:\n<<<\n{truncate(section.text)}\n>>>\n\nSlots:\n{slot_lines}"
    )
    return [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]


def request(section: Section, tranche: int, max_output_tokens: int = 2400) -> dict:
    slots = slot_plan(section, tranche)
    return {
        "custom_id": f"{section.doc_id}:t{tranche}",
        "messages": messages(section, slots),
        "response_format": Generation,
        "max_output_tokens": max_output_tokens,
    }
