"""Read-only view of `packages/knowledge` (benefits, documents, offices) for document specs."""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[3]
KNOWLEDGE = REPO / "packages" / "knowledge"


@dataclass(frozen=True)
class CatalogDocument:
    id: str
    name_de: str
    required: bool
    obtain_from: str | None = None


@dataclass(frozen=True)
class Benefit:
    id: str
    name_de: str
    name_simple: str
    area: str
    carriers: tuple[str, ...]
    documents: tuple[CatalogDocument, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class Office:
    id: str
    name_de: str
    street: str
    postal_code: str
    locality: str
    phone: str | None
    email: str | None
    carrier: str | None
    region: str | None

    @property
    def address_lines(self) -> list[str]:
        lines = [self.street] if self.street else []
        if self.postal_code:
            lines.append(f"{self.postal_code} {self.locality}".strip())
        return lines


def _load(path: Path) -> dict:
    text = unicodedata.normalize("NFC", path.read_text(encoding="utf-8"))
    return json.loads(text) if path.suffix == ".json" else yaml.safe_load(text)


@lru_cache(maxsize=1)
def benefits(root: Path = KNOWLEDGE) -> dict[str, Benefit]:
    out: dict[str, Benefit] = {}
    for path in sorted((root / "catalog").glob("*.yaml")):
        data = _load(path)
        if not isinstance(data, dict) or "id" not in data or "name_de" not in data:
            continue
        docs = tuple(
            CatalogDocument(
                id=str(d["id"]),
                name_de=str(d.get("name_de") or d["id"]),
                required=bool(d.get("required")),
                obtain_from=d.get("obtain_from"),
            )
            for d in data.get("documents") or []
            if isinstance(d, dict) and "id" in d
        )
        out[data["id"]] = Benefit(
            id=data["id"],
            name_de=str(data["name_de"]),
            name_simple=str(data.get("name_simple") or data["name_de"]),
            area=str(data.get("area") or ""),
            carriers=tuple(data.get("carriers") or ()),
            documents=docs,
        )
    return out


@lru_cache(maxsize=1)
def offices(root: Path = KNOWLEDGE) -> dict[str, Office]:
    out: dict[str, Office] = {}
    for path in sorted((root / "offices").rglob("*")):
        if path.suffix not in {".yaml", ".yml", ".json"}:
            continue
        try:
            data = _load(path)
        except Exception:  # noqa: BLE001 - malformed office files are skipped, not fatal
            continue
        if not isinstance(data, dict) or "id" not in data or "name_de" not in data:
            continue
        addr = data.get("address") if isinstance(data.get("address"), dict) else {}
        out[data["id"]] = Office(
            id=data["id"],
            name_de=str(data.get("name_de") or data["id"]),
            street=str(addr.get("street") or ""),
            postal_code=str(addr.get("postal_code") or ""),
            locality=str(addr.get("locality") or ""),
            phone=data.get("phone"),
            email=data.get("email"),
            carrier=data.get("carrier"),
            region=data.get("region"),
        )
    return out


CARRIER_NAMES = {
    "oegk": "Österreichische Gesundheitskasse",
    "bvaeb": "Versicherungsanstalt öffentlich Bediensteter, Eisenbahnen und Bergbau",
    "svs": "Sozialversicherungsanstalt der Selbständigen",
    "pva": "Pensionsversicherungsanstalt",
    "auva": "Allgemeine Unfallversicherungsanstalt",
}
CARRIER_SHORT = {"oegk": "ÖGK", "bvaeb": "BVAEB", "svs": "SVS", "pva": "PVA", "auva": "AUVA"}


def office_kind(office: Office) -> str:
    """Issuer kind decides the appeal route of a decision letter."""
    oid = office.id
    if office.carrier in CARRIER_NAMES:
        return office.carrier
    if oid.startswith("finanzamt"):
        return "finanzamt"
    if oid.startswith(("bh-", "wien-", "graz-", "fsw")) or "magistrat" in oid:
        return "authority"
    if oid.startswith("sms-"):
        return "sms"
    return "other"
