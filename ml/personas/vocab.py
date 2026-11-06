"""Value vocabularies for persona generation.

The benefit catalog is read from packages/knowledge/catalog (the product's catalog). When the
research tool server is up, `GET /catalog/summary` overrides the persona field vocabularies so that
every generated value is one the gold mapping understands.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import yaml

REPO = Path(__file__).resolve().parents[2]
CATALOG_DIR = REPO / "packages" / "knowledge" / "catalog"
GOLD_URL = os.environ.get("LOTSE_RESEARCH_URL", "http://127.0.0.1:4317")

HELDOUT_AREA = "D"

STATES: dict[str, list[str]] = {
    # Vienna: numeric districts and Styria: district names, exactly as GET /catalog/summary
    # `vocabulary.districts` lists them (the office rules compare these values).
    "Wien": list(range(1, 24)),
    "Niederösterreich": ["St. Pölten", "Wiener Neustadt", "Baden", "Mödling", "Amstetten"],
    "Burgenland": ["Eisenstadt", "Oberwart", "Neusiedl am See", "Mattersburg"],
    "Oberösterreich": ["Linz", "Wels", "Steyr", "Vöcklabruck", "Braunau am Inn"],
    "Steiermark": [
        "Graz",
        "Bruck-Mürzzuschlag",
        "Deutschlandsberg",
        "Graz-Umgebung",
        "Hartberg-Fürstenfeld",
        "Leibnitz",
        "Leoben",
        "Liezen",
        "Murau",
        "Murtal",
        "Südoststeiermark",
        "Voitsberg",
        "Weiz",
    ],
    "Kärnten": ["Klagenfurt", "Villach", "Wolfsberg", "Spittal an der Drau"],
    "Salzburg": ["Salzburg", "Hallein", "Zell am See", "St. Johann im Pongau"],
    "Tirol": ["Innsbruck", "Kufstein", "Schwaz", "Lienz", "Imst"],
    "Vorarlberg": ["Bregenz", "Dornbirn", "Feldkirch", "Bludenz"],
}
DISTRICT_STATES = ("Wien", "Steiermark")
VIENNA_DISTRICTS = {
    1: "Innere Stadt",
    2: "Leopoldstadt",
    3: "Landstraße",
    4: "Wieden",
    5: "Margareten",
    6: "Mariahilf",
    7: "Neubau",
    8: "Josefstadt",
    9: "Alsergrund",
    10: "Favoriten",
    11: "Simmering",
    12: "Meidling",
    13: "Hietzing",
    14: "Penzing",
    15: "Rudolfsheim-Fünfhaus",
    16: "Ottakring",
    17: "Hernals",
    18: "Währing",
    19: "Döbling",
    20: "Brigittenau",
    21: "Floridsdorf",
    22: "Donaustadt",
    23: "Liesing",
}
STATE_WEIGHTS = {
    "Wien": 21,
    "Niederösterreich": 19,
    "Burgenland": 3,
    "Oberösterreich": 17,
    "Steiermark": 14,
    "Kärnten": 6,
    "Salzburg": 6,
    "Tirol": 9,
    "Vorarlberg": 5,
}

# internal status -> (carrier, pension_carrier, employment, card status). Carrier and status values
# follow the engine's office context (packages/knowledge/data/office-context.json): lower-case
# carrier ids and the status keys it maps to a pension source; detail stays in `employment`.
STATUSES: dict[str, tuple[str | None, str | None, str, str]] = {
    "employed": ("oegk", None, "employed", "employed"),
    "marginal": ("oegk", None, "marginal_employment", "employed"),
    "self_employed": ("svs", None, "self_employed", "employed"),
    "farmer": ("svs", None, "farmer", "employed"),
    "civil_servant": ("bvaeb", None, "civil_servant", "employed"),
    "pensioner": ("oegk", "pva", "retired", "pensioner"),
    "pensioner_svs": ("svs", "svs", "retired", "pensioner"),
    "pensioner_bvaeb": ("bvaeb", "bvaeb", "retired", "pensioner"),
    "unemployed": ("oegk", None, "unemployed", "dependent"),
    "student": ("oegk", None, "student", "co-insured"),
    "co_insured": ("oegk", None, "homemaker", "co-insured"),
    "parental_leave": ("oegk", None, "parental_leave", "employed"),
    "uninsured": (None, None, "none", "none"),
}
INCOME_BANDS = ["lt_1300", "1300_2000", "2000_3000", "gt_3000"]
NEEDS = ["mobility", "household", "personal_care", "medication", "supervision", "meals"]
DOCUMENTS = [
    "e_card",
    "discharge_letter",
    "findings",
    "prescription",
    "referral",
    "pension_notice",
    "payslip",
    "birth_certificate",
    "care_decision",
    "invoice",
    "sick_note",
    "registration",
]
LANGUAGES = {"de-AT": 0.70, "en": 0.15, "tr": 0.15}


@dataclass
class Benefit:
    id: str
    name: str
    area: str
    life_situations: list[str] = field(default_factory=list)
    documents: list[str] = field(default_factory=list)


@dataclass
class Vocab:
    benefits: dict[str, Benefit]
    source: str
    summary: dict | None = None

    @property
    def heldout_benefits(self) -> set[str]:
        return {b.id for b in self.benefits.values() if b.area == HELDOUT_AREA}

    def bundle_areas(self, life_situation: str) -> set[str]:
        return {b.area for b in self.benefits.values() if life_situation in b.life_situations}

    def area_of(self, benefit_id: str) -> str | None:
        b = self.benefits.get(benefit_id)
        return b.area if b else None


def load_catalog_yaml() -> dict[str, Benefit]:
    out: dict[str, Benefit] = {}
    for path in sorted(CATALOG_DIR.glob("*.yaml")):
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(doc, dict) or "id" not in doc:
            continue
        out[doc["id"]] = Benefit(
            id=doc["id"],
            name=doc.get("name_de", doc["id"]),
            area=str(doc.get("area", "")),
            life_situations=list(doc.get("life_situations") or []),
            documents=[d["id"] for d in doc.get("documents") or [] if "id" in d],
        )
    return out


def fetch_summary(url: str = GOLD_URL, timeout: float = 5.0) -> dict | None:
    try:
        r = httpx.get(f"{url}/catalog/summary", timeout=timeout)
        r.raise_for_status()
        return r.json()
    except (httpx.HTTPError, json.JSONDecodeError):
        return None


def load_vocab(use_server: bool = True) -> Vocab:
    benefits = load_catalog_yaml()
    summary = fetch_summary() if use_server else None
    if summary and isinstance(summary.get("benefits"), list):
        for b in summary["benefits"]:
            bid = b.get("id")
            if not bid:
                continue
            benefits[bid] = Benefit(
                id=bid,
                name=b.get("name") or b.get("name_de") or bid,
                area=str(b.get("area", "")),
                life_situations=list(b.get("life_situations") or []),
                documents=[d["id"] for d in b.get("documents") or [] if "id" in d],
            )
        return Vocab(benefits=benefits, source="catalog/summary", summary=summary)
    return Vocab(benefits=benefits, source="packages/knowledge/catalog")
