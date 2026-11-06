"""Deterministic per-dialogue variants: target language, Austrian dialect, plain language and
injected medical questions (safety behaviour). Seeded by dialogue id, so reruns are identical."""

from __future__ import annotations

import hashlib
import random
from dataclasses import asdict, dataclass
from typing import Any

from gym import slots as S

# Languages of the dataset (datagen/config.yaml); persona languages are de, en and tr.
LANGUAGE_NAMES = {
    "de": "German (Austrian standard German)",
    "en": "English",
    "tr": "Turkish",
    "bcs": "Bosnian/Croatian/Serbian (BCS, Latin script)",
    "ro": "Romanian",
    "hu": "Hungarian",
    "pl": "Polish",
    "uk": "Ukrainian",
    "ar": "Arabic (Modern Standard Arabic, simple wording)",
}
EXTRA_LANGUAGES = ("bcs", "ro", "hu", "pl", "uk", "ar")


@dataclass(frozen=True)
class Variant:
    language: str  # ISO-ish code of the dialogue language
    source_language: str  # persona language
    language_variant: bool  # user speaks a dataset language other than the persona's
    dialect: bool  # user turns in Austrian German dialect / colloquial speech
    plain_language: bool  # pilot writes plain language (B1, "Einfache Sprache")
    safety: bool  # a medical question is injected; the pilot hands off to doctor/1450
    safety_after: int  # insert after this many question turns

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def rng_for(key: str) -> random.Random:
    return random.Random(int(hashlib.sha256(key.encode()).hexdigest()[:16], 16))


def choose(
    dialogue_id: str,
    persona: dict[str, Any],
    n_questions: int,
    *,
    p_extra_language: float = 0.3,
    p_plain: float = 0.2,
    p_safety: float = 0.15,
    languages: tuple[str, ...] = EXTRA_LANGUAGES,
) -> Variant:
    rng = rng_for(dialogue_id)
    member = S.speaker(persona)
    source = S.language(persona)
    language, variant = source, False
    if languages and rng.random() < p_extra_language:
        language, variant = rng.choice(list(languages)), True
    register = str(member.get("register") or "neutral")
    dialect = language == "de" and (
        register == "dialect" or (register == "colloquial" and rng.random() < 0.5)
    )
    plain = str(member.get("literacy") or "") == "low" or rng.random() < p_plain
    safety = rng.random() < p_safety
    return Variant(
        language=language,
        source_language=source,
        language_variant=variant,
        dialect=dialect,
        plain_language=plain,
        safety=safety,
        safety_after=rng.randint(0, max(0, n_questions)),
    )
