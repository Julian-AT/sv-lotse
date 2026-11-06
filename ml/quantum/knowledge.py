"""Read-only access to the product knowledge base in packages/knowledge.

The quantum instances are built from the same YAML/JSON files the product uses: catalog
benefits (life situations, office rules, documents), process definitions (steps, actions,
reminders), offices/facilities (addresses, opening hours) and the GeoNames postcode centroids.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE = ROOT / "packages" / "knowledge"

DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
_DAY_WORDS = {
    "montag": 0,
    "mo": 0,
    "dienstag": 1,
    "di": 1,
    "mittwoch": 2,
    "mi": 2,
    "donnerstag": 3,
    "do": 3,
    "freitag": 4,
    "fr": 4,
    "samstag": 5,
    "sa": 5,
    "sonntag": 6,
    "so": 6,
}


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def _load(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh) if path.suffix == ".json" else yaml.safe_load(fh)


@cache
def catalog() -> dict[str, dict]:
    out = {}
    for p in sorted((KNOWLEDGE / "catalog").glob("*.yaml")):
        d = _load(p)
        d["_file"] = rel(p)
        out[d["id"]] = d
    return out


@cache
def processes() -> dict[str, dict]:
    out = {}
    for p in sorted((KNOWLEDGE / "processes").glob("*.yaml")):
        d = _load(p)
        d["_file"] = rel(p)
        out[d["id"]] = d
    return out


@cache
def places() -> dict[str, dict]:
    """Offices and facilities by id (YAML and JSON records)."""
    out = {}
    for base in ("offices", "facilities"):
        for p in sorted((KNOWLEDGE / base).rglob("*")):
            if p.suffix not in (".yaml", ".json"):
                continue
            d = _load(p)
            if isinstance(d, dict) and "id" in d:
                d["_file"] = rel(p)
                out[d["id"]] = d
    return out


@cache
def postcodes() -> dict[str, dict]:
    return _load(KNOWLEDGE / "data" / "postcodes-at.json")["postcodes"]


def bundle(life_situation: str) -> list[str]:
    """Benefit ids of a life-situation bundle, in catalog order."""
    return [b for b, d in catalog().items() if life_situation in (d.get("life_situations") or [])]


def process_for(benefit_id: str) -> dict | None:
    ref = catalog()[benefit_id].get("process") or ""
    return processes().get(ref.split("/")[-1])


class _Facts(dict):
    def __missing__(self, key):
        return None


def resolve_office(benefit_id: str, facts: dict) -> str | None:
    """First matching office rule (the rules are Python-compatible boolean expressions)."""
    ns = _Facts(facts, true=True, false=False)
    for rule in catalog()[benefit_id].get("office_rules") or []:
        try:
            ok = bool(eval(str(rule["when"]), {"__builtins__": {}}, ns))  # noqa: S307
        except Exception:
            ok = False
        if ok:
            return str(rule["office"]).split("/")[-1]
    return None


# --- opening hours --------------------------------------------------------------------------

_TIME = r"(\d{1,2})(?:[:.](\d{2}))?"
_RANGE = re.compile(_TIME + r"\s*(?:uhr)?\s*(?:–|-|bis)\s*" + _TIME)
_DAYTOK = re.compile(
    r"\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\b"
    r"(?:\s*(?:–|-|bis)\s*"
    r"\b(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr|sa|so)\b)?"
)


def parse_opening_hours(value) -> dict[int, list[tuple[int, int]]]:
    """Weekday -> list of (start_min, end_min). Later segments override earlier ones per day.

    Handles the formats present in the knowledge base, e.g. "Montag:07.30 – 14.30",
    "Mo–Fr 8:00–15:00 Uhr; Do 8:00–17:30 Uhr" and "Montag bis Mittwoch und Freitag von 7:00
    bis 15:00 Uhr". Segments without a weekday or a time range are ignored.
    """
    if isinstance(value, dict):
        value = value.get("notes") or ""
    if not isinstance(value, str):
        return {}
    hours: dict[int, list[tuple[int, int]]] = {}
    for seg in re.split(r"[\n;]", value):
        low = seg.lower()
        if "annahmeschluss" in low:
            low = re.sub(r"\(annahmeschluss[^)]*\)", "", low)
        if "feiertag" in low or "karfreitag" in low:
            continue
        days: set[int] = set()
        for a, b in _DAYTOK.findall(low):
            if b:
                days.update(range(_DAY_WORDS[a], _DAY_WORDS[b] + 1))
            else:
                days.add(_DAY_WORDS[a])
        ranges = []
        for h1, m1, h2, m2 in _RANGE.findall(low):
            s, e = int(h1) * 60 + int(m1 or 0), int(h2) * 60 + int(m2 or 0)
            if 0 <= s < e <= 24 * 60:
                ranges.append((s, e))
        if days and ranges:
            for d in days:
                hours[d] = sorted(ranges)
    return hours


def coords(place: dict) -> tuple[float, float] | None:
    pc = str((place.get("address") or {}).get("postal_code") or "")
    c = postcodes().get(pc)
    return (c["lat"], c["lon"]) if c else None


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = (
        math.sin((la2 - la1) / 2) ** 2
        + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    )
    return 2 * 6371.0 * math.asin(math.sqrt(h))


@dataclass
class ResolvedPlace:
    id: str
    file: str
    name: str
    postal_code: str
    coords: tuple[float, float]
    hours: dict[int, list[tuple[int, int]]]
    substituted_for: str | None = None
    notes: list[str] = field(default_factory=list)


def usable_place(office_id: str, home: tuple[float, float]) -> ResolvedPlace | None:
    """The resolved office if it has opening hours and coordinates; otherwise the nearest
    office of the same carrier in the same region that has both (documented substitution)."""
    pl = places().get(office_id)
    if pl is None:
        return None

    def ok(p):
        return bool(parse_opening_hours(p.get("opening_hours"))) and coords(p) is not None

    def make(p, sub=None):
        return ResolvedPlace(
            id=p["id"],
            file=p["_file"],
            name=p.get("name_de", p["id"]),
            postal_code=str(p["address"]["postal_code"]),
            coords=coords(p),
            hours=parse_opening_hours(p.get("opening_hours")),
            substituted_for=sub,
        )

    if ok(pl):
        return make(pl)
    carrier = pl.get("carrier") or office_id.split("-")[0]
    region = pl.get("region")
    cands = [
        p
        for p in places().values()
        if (p.get("carrier") or p["id"].split("-")[0]) == carrier
        and p.get("region") == region
        and ok(p)
    ]
    if not cands:
        return None
    best = min(cands, key=lambda p: (haversine_km(home, coords(p)), p["id"]))
    return make(best, sub=office_id)
