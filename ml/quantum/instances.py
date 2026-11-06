"""Instance builders for Q-A (case scheduling) and Q-B (document set cover).

Everything is derived from packages/knowledge; nothing is sampled at random.

Q-A modelling choices (documented here and copied into results.json):
- Case steps: process steps of the bundle's benefits whose action needs a visit:
  ``office.resolve`` -> office visit (60 min), ``documents.checklist`` -> document submission or
  pickup (30 min), ``appointment.prepare`` -> appointment (60 min). Steps are taken round-robin
  over the bundle's benefits so consecutive steps sit at different offices.
- Place: the office from the benefit's ``office_rules`` for the persona facts. If that office has
  no parseable opening hours, the nearest office of the same carrier and region that has them is
  used (``substituted_for`` records it). Steps without a usable place are listed as skipped.
- Slots: weekdays from Monday, candidate starts on a fixed grid (default 08:00, 09:00, 10:00,
  11:00, 13:00, 14:00); a start is allowed only if [start, start + duration) lies inside an
  opening interval.
- Deadlines: no process step in the knowledge base defines a deadline (the process files state
  that reminders are prompts, not statutory deadlines). We use the reminder ``after_days`` as a
  soft due day where present and the horizon end otherwise.
- Travel: straight-line distance between the postcode centroids (GeoNames, data/postcodes-at.json)
  at 30 km/h, rounded to minutes. Vienna postcodes share one centroid in that file, so most
  intra-Vienna travel times are 0; the Lower Austria persona has real distances.

Q-B: elements are a bundle's documents[] entries (required ones by default); sets are the
sources a person would visit or contact (employer, pension carrier, doctor, ...), matched from the
``obtain_from`` text with fixed patterns. An element belongs to every source its text names.
"""

from __future__ import annotations

import hashlib
import json
import re

from . import knowledge as kb

SPEED_KMH = 30.0
GRID = (8 * 60, 9 * 60, 10 * 60, 11 * 60, 13 * 60, 14 * 60)
DURATION = {"office.resolve": 60, "documents.checklist": 30, "appointment.prepare": 60}
KIND = {
    "office.resolve": "office-visit",
    "documents.checklist": "document-submission",
    "appointment.prepare": "appointment",
}

PERSONAS = {
    # Fictitious persona facts; only used to evaluate the catalog office rules.
    "care-wien": {
        "home_postal_code": "1150",
        "facts": {
            "residence_region": "Wien",
            "residence_state": "Wien",
            "federal_state": "Wien",
            "pension_source": "asvg",
            "contact_carrier": "pva",
            "insurance_carrier": "oegk",
            "carrier": "oegk",
            "housing_emergency": False,
            "permanent_benefit": True,
            "age": 78,
        },
    },
    "care-noe": {
        "home_postal_code": "2230",
        "facts": {
            "residence_region": "Niederösterreich",
            "residence_state": "Niederösterreich",
            "federal_state": "Niederösterreich",
            "pension_source": "asvg",
            "contact_carrier": "oegk",
            "insurance_carrier": "oegk",
            "carrier": "oegk",
            "age": 81,
        },
    },
}

SOURCES = [
    ("pension-carrier", r"pflegegeldträger|pension|über das pflegegeld entschieden"),
    (
        "insurance-carrier",
        r"sozialversicherungsträger|versicherungsträger|krankenversicherungsträger",
    ),
    ("employer", r"arbeitgeber"),
    ("doctor", r"ärztin|arzt|arztpraxis|krankenhaus"),
    ("caregiver", r"betreuungskraft"),
    (
        "civil-registry",
        r"meldebehörde|ausweisbehörde|passbehörde|staatsbürgerschaft"
        r"|standesamt|aufenthaltsbehörde",
    ),
    ("landlord", r"vermiet|hausverwaltung"),
    ("bank", r"\bbank|kontoausz"),
    ("ams", r"\bams\b"),
    ("sozialministeriumservice", r"sozialministeriumservice"),
    ("court", r"gericht"),
    ("supplier", r"fachbetrieb"),
]


def canonical_hash(obj: dict) -> str:
    body = {k: v for k, v in obj.items() if k != "sha256"}
    s = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _due_day(step: dict, days: int) -> int:
    after = [int(r["after_days"]) for r in step.get("reminders") or [] if "after_days" in r]
    return min(min(after), days - 1) if after else days - 1


def candidate_steps(persona: str, life_situation: str, days: int) -> tuple[list[dict], list[dict]]:
    p = PERSONAS[persona]
    home = kb.postcodes()[p["home_postal_code"]]
    home = (home["lat"], home["lon"])
    per_benefit, skipped = [], []
    for b in kb.bundle(life_situation):
        proc = kb.process_for(b)
        if proc is None:
            skipped.append({"benefit": b, "reason": "no process"})
            continue
        office_id = kb.resolve_office(b, p["facts"])
        place = kb.usable_place(office_id, home) if office_id else None
        rows = []
        for s in proc["steps"]:
            act = s.get("action")
            if act not in DURATION:
                continue
            if place is None:
                skipped.append(
                    {
                        "benefit": b,
                        "step": s["id"],
                        "office": office_id,
                        "reason": "no office with opening hours and coordinates",
                    }
                )
                continue
            rows.append(
                {
                    "id": f"{b}/{s['id']}",
                    "benefit": b,
                    "process_file": proc["_file"],
                    "step": s["id"],
                    "action": act,
                    "kind": KIND[act],
                    "duration": DURATION[act],
                    "due_day": _due_day(s, days),
                    "place": place.id,
                    "place_file": place.file,
                    "substituted_for": place.substituted_for,
                    "postal_code": place.postal_code,
                    "coords": list(place.coords),
                    "hours": {kb.DAYS[d]: v for d, v in sorted(place.hours.items())},
                }
            )
        if rows:
            per_benefit.append(rows)
    ordered = []
    for k in range(max((len(r) for r in per_benefit), default=0)):
        ordered += [r[k] for r in per_benefit if k < len(r)]
    return ordered, skipped


def build_qa(
    persona: str, life_situation: str, n_steps: int, days: int, grid: tuple[int, ...] = GRID
) -> dict:
    steps, skipped = candidate_steps(persona, life_situation, days)
    steps = steps[:n_steps]
    variables = []
    for i, s in enumerate(steps):
        hours = {kb.DAYS.index(k): v for k, v in s["hours"].items()}
        for d in range(days):
            for g, start in enumerate(grid):
                end = start + s["duration"]
                if any(a <= start and end <= b for a, b in hours.get(d, [])):
                    late = 60 * max(0, d - s["due_day"]) + 10 * d + g
                    variables.append(
                        {
                            "step": i,
                            "day": d,
                            "grid": g,
                            "start": start,
                            "end": end,
                            "lateness": late,
                        }
                    )
    n = len(steps)
    travel = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            km = kb.haversine_km(tuple(steps[i]["coords"]), tuple(steps[j]["coords"]))
            travel[i][j] = round(km / SPEED_KMH * 60)
    inst = {
        "kind": "Q-A",
        "persona": persona,
        "life_situation": life_situation,
        "bundle": kb.bundle(life_situation),
        "days": days,
        "grid": list(grid),
        "speed_kmh": SPEED_KMH,
        "steps": steps,
        "skipped": skipped,
        "variables": variables,
        "travel_min": travel,
    }
    inst["name"] = f"qa-{persona}-{life_situation}-s{n}-d{days}-v{len(variables)}"
    inst["sha256"] = canonical_hash(inst)
    return inst


def build_qb(
    life_situations: tuple[str, ...],
    include_optional: bool = False,
    max_elements: int | None = None,
) -> dict:
    cat = kb.catalog()
    elements, seen = [], set()
    for ls in life_situations:
        for b in kb.bundle(ls):
            for doc in cat[b].get("documents") or []:
                if not (doc.get("required") or include_optional) or (b, doc["id"]) in seen:
                    continue
                text = str(doc.get("obtain_from") or "").lower()
                srcs = [sid for sid, pat in SOURCES if re.search(pat, text)]
                if not srcs:
                    continue
                seen.add((b, doc["id"]))
                elements.append(
                    {
                        "id": f"{b}#{doc['id']}",
                        "file": cat[b]["_file"],
                        "name_de": doc.get("name_de"),
                        "sources": srcs,
                    }
                )
    if max_elements is not None:
        elements = elements[:max_elements]
    sets = []
    for sid, _ in SOURCES:
        members = [k for k, e in enumerate(elements) if sid in e["sources"]]
        if members:
            sets.append({"id": sid, "elements": members})
    inst = {
        "kind": "Q-B",
        "life_situations": list(life_situations),
        "include_optional": include_optional,
        "elements": elements,
        "sets": sets,
        "source_patterns": dict(SOURCES),
    }
    inst["name"] = (
        f"qb-{'+'.join(life_situations)}-{'all' if include_optional else 'req'}"
        f"-e{len(elements)}-s{len(sets)}"
    )
    inst["sha256"] = canonical_hash(inst)
    return inst
