# ruff: noqa: E501 (natural-language templates)
"""Situation text rendering: templates, facts, noise, dialect and phrasing styles (no LLM calls)."""

from __future__ import annotations

import random
import re

from .goals import GOALS_BY_ID
from .vocab import VIENNA_DISTRICTS

TRAIN_STYLES = ("plain", "question_first", "story", "chatty")
HELDOUT_STYLES = ("telegraphic", "formal_letter")  # used only in the test split

REL = {
    "de": {
        "mother": ("Meine Mutter", "meine Mutter", "sie", "Sie"),
        "father": ("Mein Vater", "meinen Vater", "er", "Er"),
        "wife": ("Meine Frau", "meine Frau", "sie", "Sie"),
        "husband": ("Mein Mann", "meinen Mann", "er", "Er"),
        "grandmother": ("Meine Oma", "meine Oma", "sie", "Sie"),
        "neighbour_f": ("Meine Nachbarin", "meine Nachbarin", "sie", "Sie"),
    },
    "en": {
        "mother": ("my mother", "my mother", "she", "She"),
        "father": ("my father", "my father", "he", "He"),
        "wife": ("my wife", "my wife", "she", "She"),
        "husband": ("my husband", "my husband", "he", "He"),
        "grandmother": ("my grandmother", "my grandmother", "she", "She"),
        "neighbour_f": ("my neighbour", "my neighbour", "she", "She"),
    },
    "tr": {
        "mother": ("Annem", "annem", "o", "O"),
        "father": ("Babam", "babam", "o", "O"),
        "wife": ("Eşim", "eşim", "o", "O"),
        "husband": ("Eşim", "eşim", "o", "O"),
        "grandmother": ("Babaannem", "babaannem", "o", "O"),
        "neighbour_f": ("Komşum", "komşum", "o", "O"),
    },
}

STATUS_WORDS = {
    "de": {
        "employed": "angestellt",
        "marginal": "geringfügig beschäftigt",
        "self_employed": "selbständig",
        "farmer": "Landwirt",
        "civil_servant": "Beamter",
        "pensioner": "in Pension",
        "pensioner_svs": "in Pension, früher selbständig",
        "pensioner_bvaeb": "in Beamtenpension",
        "unemployed": "arbeitslos",
        "student": "Student",
        "co_insured": "mitversichert",
        "parental_leave": "in Karenz",
        "uninsured": "nicht versichert",
    },
    "en": {
        "employed": "employed",
        "marginal": "in a small part-time job",
        "self_employed": "self-employed",
        "farmer": "a farmer",
        "civil_servant": "a civil servant",
        "pensioner": "retired",
        "pensioner_svs": "retired, I used to be self-employed",
        "pensioner_bvaeb": "a retired civil servant",
        "unemployed": "unemployed",
        "student": "a student",
        "co_insured": "co-insured with my partner",
        "parental_leave": "on parental leave",
        "uninsured": "not insured",
    },
    "tr": {
        "employed": "çalışıyorum",
        "marginal": "küçük bir işte çalışıyorum",
        "self_employed": "serbest çalışıyorum",
        "farmer": "çiftçiyim",
        "civil_servant": "memurum",
        "pensioner": "emekliyim",
        "pensioner_svs": "emekliyim, önceden kendi işim vardı",
        "pensioner_bvaeb": "memur emeklisiyim",
        "unemployed": "işsizim",
        "student": "öğrenciyim",
        "co_insured": "eşimin üzerinden sigortalıyım",
        "parental_leave": "doğum iznindeyim",
        "uninsured": "sigortam yok",
    },
}
CARRIER_WORDS = {"OEGK": "ÖGK", "SVS": "SVS", "BVAEB": "BVAEB"}
INCOME_WORDS = {
    "de": {
        "lt_1300": "unter 1.300 Euro",
        "1300_2000": "so 1.500 bis 2.000 Euro",
        "2000_3000": "um die 2.500 Euro",
        "gt_3000": "über 3.000 Euro",
    },
    "en": {
        "lt_1300": "under 1,300 euros",
        "1300_2000": "about 1,500 to 2,000 euros",
        "2000_3000": "around 2,500 euros",
        "gt_3000": "over 3,000 euros",
    },
    "tr": {
        "lt_1300": "1.300 avronun altında",
        "1300_2000": "1.500 ile 2.000 avro arası",
        "2000_3000": "2.500 avro civarı",
        "gt_3000": "3.000 avronun üstünde",
    },
}
NEED_WORDS = {
    "de": {
        "mobility": "beim Gehen",
        "household": "im Haushalt",
        "personal_care": "beim Waschen und Anziehen",
        "medication": "bei den Medikamenten",
        "supervision": "weil man sie nicht allein lassen kann",
        "meals": "beim Essen",
    },
    "en": {
        "mobility": "with walking",
        "household": "with housework",
        "personal_care": "with washing and dressing",
        "medication": "with medication",
        "supervision": "because they can't be left alone",
        "meals": "with meals",
    },
    "tr": {
        "mobility": "yürürken",
        "household": "ev işlerinde",
        "personal_care": "yıkanıp giyinirken",
        "medication": "ilaçlarda",
        "supervision": "yalnız bırakılamadığı için",
        "meals": "yemekte",
    },
}

DIALECT = [
    (r"\bnicht\b", "ned"),
    (r"\bNicht\b", "Ned"),
    (r"\bich\b", "i"),
    (r"\bIch\b", "I"),
    (r"\bist\b", "is"),
    (r"\betwas\b", "wos"),
    (r"\bwas\b", "wos"),
    (r"\bWas\b", "Wos"),
    (r"\bauch\b", "a"),
    (r"\bschon\b", "scho"),
    (r"\bnichts\b", "nix"),
    (r"\beine\b", "a"),
    (r"\bein\b", "a"),
    (r"\bjetzt\b", "jetz"),
    (r"\bhabe\b", "hob"),
    (r"\bhab\b", "hob"),
    (r"\bhaben\b", "hobn"),
    (r"\bkann\b", "ko"),
    (r"\bMutter\b", "Muatta"),
    (r"\bVater\b", "Vota"),
    (r"\bweiß\b", "woaß"),
    (r"\bkeine\b", "ka"),
    (r"\bkein\b", "ka"),
    (r"\bgeht\b", "geht"),
    (r"\bdas\b", "des"),
    (r"\bDas\b", "Des"),
    (r"\bwir\b", "mia"),
    (r"\bWir\b", "Mia"),
    (r"\bmir\b", "ma"),
    (r"\bmich\b", "mi"),
    (r"\bdich\b", "di"),
    (r"\bsind\b", "san"),
    (r"\bgut\b", "guat"),
    (r"\bein bisschen\b", "a bissl"),
    (r"\bOma\b", "Omi"),
    (r"\bgehen\b", "geh'n"),
    (r"\bnoch\b", "no"),
    (r"\bmal\b", "amoi"),
    (r"\bmehr\b", "mehr"),
]
COLLOQUIAL_FILLERS = {
    "de": ("Na ja, ", "Also, ", "Hallo, ", "Grüß Gott, ", "Servus, ", ""),
    "en": ("Hi, ", "Hello, ", "So, ", "Well, ", ""),
    "tr": ("Merhaba, ", "Selam, ", "Şey, ", ""),
}


def lang_key(language: str) -> str:
    return "de" if language.startswith("de") else language


def _facts(
    rng: random.Random, persona: dict, lang: str, persp: str, partial: float, contradiction: float
) -> list[str]:
    """Sentences stating card facts; each is dropped or replaced by 'not sure' with p=partial."""
    hh = persona["household"]
    subj = next(m for m in hh if m["role"] == "subject")
    third = persp == "other"
    out: list[str] = []
    age = subj["age"]
    state = subj["residence"]["state"]
    district = subj["residence"]["district"]
    ins = subj["insurance"]
    unsure = {
        "de": (
            "Wie genau die Versicherung heißt, weiß ich nicht.",
            "Das mit dem Einkommen weiß ich nicht genau.",
        ),
        "en": ("I'm not sure which insurance it is exactly.", "I don't know the income exactly."),
        "tr": ("Sigortanın adını tam bilmiyorum.", "Geliri tam bilmiyorum."),
    }[lang]

    # Age.
    wrong_age = age + rng.choice((-3, -2, 2, 3))
    if rng.random() >= partial:
        if lang == "de":
            s = f"{'{Pron} ist' if third else 'Ich bin'} {age} Jahre alt."
        elif lang == "en":
            s = f"{'{Pron} is' if third else 'I am'} {age} years old."
        else:
            s = f"{'{Pron}' if third else 'Ben'} {age} yaşında{'.' if third else 'yım.'}"
        if rng.random() < contradiction:
            s += {
                "de": f" Nein warte, eigentlich {wrong_age}... oder doch {age}.",
                "en": f" Wait, actually {wrong_age}... no, {age}.",
                "tr": f" Yok, aslında {wrong_age}... hayır, {age}.",
            }[lang]
        out.append(s)
    # Residence.
    if rng.random() >= partial * 0.5:
        loc = district if district is not None and rng.random() < 0.5 else state
        if isinstance(loc, int):  # Vienna district number
            name = VIENNA_DISTRICTS[loc]
            loc = {
                "de": rng.choice((f"Wien {loc}", f"Wien-{name}", f"{name}")),
                "en": rng.choice((f"Vienna's district {loc}", f"{name}, Vienna")),
                "tr": rng.choice((f"Viyana {loc}. bölge", f"Viyana {name}")),
            }[lang]
        loc_de = f"der {loc}" if loc == "Steiermark" else loc
        s = {
            "de": f"Wir wohnen in {loc_de}.",
            "en": f"We live in {loc}.",
            "tr": f"{loc} bölgesinde oturuyoruz.",
        }[lang]
        if third and lang == "de":
            s = f"{{Pron}} wohnt in {loc_de}."
        if rng.random() < contradiction * 0.5:
            other = rng.choice(["Wien", "Graz", "Linz", "Salzburg", "Innsbruck"])
            if other != loc:
                s += {
                    "de": f" Also gemeldet ist das vielleicht noch in {other}, da bin ich nicht sicher.",
                    "en": f" Well, the registration might still be in {other}, I'm not sure.",
                    "tr": f" Ama kaydı hâlâ {other} bölgesinde olabilir, emin değilim.",
                }[lang]
        out.append(s)
    # Insurance / status.
    if rng.random() >= partial:
        st = STATUS_WORDS[lang][persona["_status"]]
        carrier = CARRIER_WORDS.get((ins["carrier"] or "").upper())
        if lang == "de":
            s = f"{'{Pron} ist' if third else 'Ich bin'} {st}"
            s += f", versichert bei der {carrier}." if carrier and rng.random() < 0.6 else "."
        elif lang == "en":
            s = f"{'{Pron} is' if third else 'I am'} {st}"
            s += f", insured with {carrier}." if carrier and rng.random() < 0.6 else "."
        else:
            s = f"{'{Pron} ' if third else ''}{st}"
            own = "sigortası" if third else "sigortam"
            s += f", {own} {carrier}." if carrier and rng.random() < 0.6 else "."
        out.append(s)
    else:
        out.append(unsure[0])
    # Income.
    if rng.random() < 0.6:
        if rng.random() >= partial:
            inc = INCOME_WORDS[lang][subj["income_band"]]
            out.append(
                {
                    "de": f"Im Monat sind es {inc} netto.",
                    "en": f"Monthly it's {inc} net.",
                    "tr": f"Aylık net gelir {inc}.",
                }[lang]
            )
        else:
            out.append(unsure[1])
    # Care needs.
    needs = subj["care"]["needs"]
    if needs and rng.random() >= partial * 0.5:
        words = [NEED_WORDS[lang][n] for n in needs[:3]]
        joined = {"de": " und ", "en": " and ", "tr": " ve "}[lang].join(words)
        out.append(
            {
                "de": f"Hilfe braucht es vor allem {joined}.",
                "en": f"Help is needed mostly {joined}.",
                "tr": f"En çok {joined} yardım gerekiyor.",
            }[lang]
        )
    # Children.
    kids = subj["children"]
    if kids and rng.random() >= partial * 0.5:
        ages = ", ".join(str(c["age"]) for c in kids)
        out.append(
            {
                "de": f"Die Kinder sind {ages} Jahre alt."
                if len(kids) > 1
                else f"Das Kind ist {ages}.",
                "en": f"The kids are {ages}." if len(kids) > 1 else f"My child is {ages}.",
                "tr": f"Çocuklar {ages} yaşında." if len(kids) > 1 else f"Çocuğum {ages} yaşında.",
            }[lang]
        )
    # Documents.
    docs = subj["documents_held"]
    if "discharge_letter" in docs and rng.random() < 0.5:
        out.append(
            {
                "de": "Den Entlassungsbrief vom Spital hab ich da.",
                "en": "I have the discharge letter from the hospital.",
                "tr": "Hastaneden çıkış mektubu elimde.",
            }[lang]
        )
    return out


def _dialect(text: str, p: float, rng: random.Random) -> str:
    for pat, rep in DIALECT:
        text = re.sub(pat, lambda m, rep=rep: rep if rng.random() < p else m.group(0), text)
    return text


def render(persona: dict, style: str, rng: random.Random, variant_offset: int = 0) -> str:
    goal = GOALS_BY_ID[persona["_scenario"]]
    speaker = next(
        (m for m in persona["household"] if m["role"] == "helper"), persona["household"][0]
    )
    lang = lang_key(speaker["language"])
    persp = persona["_persp"]
    rel_key = persona.get("_rel", "mother")
    variants = goal.text[lang][persp]
    core = variants[(rng.randrange(len(variants)) + variant_offset) % len(variants)]
    noise = persona["noise"]
    facts = _facts(rng, persona, lang, persp, noise["partial_knowledge"], noise["contradiction"])
    rng.shuffle(facts)

    if style == "telegraphic":
        parts = [core.split(".")[0].split("?")[0]] + [f.rstrip(".") for f in facts]
        body = " – ".join(p.strip() for p in parts if p.strip()) + "."
    elif style == "formal_letter":
        hello, bye = {
            "de": ("Sehr geehrte Damen und Herren,", "Mit freundlichen Grüßen"),
            "en": ("Dear Sir or Madam,", "Kind regards"),
            "tr": ("Sayın yetkili,", "Saygılarımla"),
        }[lang]
        body = f"{hello} {' '.join(facts)} {core} {bye}"
    elif style == "question_first":
        body = " ".join([core, *facts])
    elif style == "story":
        body = " ".join([*facts, core])
    elif style == "chatty":
        mid = len(facts) // 2
        body = " ".join([*facts[:mid], core, *facts[mid:]])
        thanks = {
            "de": " Danke schon mal!",
            "en": " Thanks a lot!",
            "tr": " Şimdiden teşekkürler!",
        }[lang]
        body += thanks
    else:
        body = " ".join([core, *facts]) if rng.random() < 0.5 else " ".join([*facts, core])

    rel_nom, rel_acc, pron, Pron = REL[lang][rel_key]
    body = body.replace("{rel_acc}", rel_acc).replace("{rel}", rel_nom if lang == "tr" else rel_acc)
    body = body.replace("{Pron}", Pron).replace("{pron}", pron)
    if (
        lang == "de"
        and speaker["register"] in ("colloquial", "dialect")
        and style != "formal_letter"
    ):
        body = re.sub(r"\bhabe\b", "hab", body)
        if speaker["register"] == "dialect" or noise["dialect"] > 0.5:
            body = _dialect(body, noise["dialect"], rng)
    if speaker["literacy"] == "low" and style != "formal_letter":
        body = body.replace("ß", "ss") if rng.random() < 0.4 else body
        body = body.lower() if rng.random() < 0.25 else body
    # Capitalise sentence starts that a placeholder lowered.
    body = (
        re.sub(r"(^|[.?!] )([a-zäöü])", lambda m: m.group(1) + m.group(2).upper(), body)
        if not body.islower()
        else body
    )
    body = re.sub(r"\s+", " ", body).strip()
    if style == "chatty":
        filler = rng.choice(COLLOQUIAL_FILLERS[lang])
        if (
            filler
            and body[:2] not in ("I ", "I'")
            and not body.startswith(("Ich", "Es", "Ben", "Wir"))
        ):
            body = body[0].lower() + body[1:]
        body = filler + body
    return body
