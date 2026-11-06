"""SV-relevant federal acts and their RIS Gesetzesnummern (verified against the RIS OGD API)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Act:
    abbr: str
    gesetzesnummer: str
    title: str
    in_force: bool = True  # False: repealed act, the last consolidated version is used


ACTS: dict[str, Act] = {
    a.abbr: a
    for a in [
        Act("ASVG", "10008147", "Allgemeines Sozialversicherungsgesetz"),
        Act("GSVG", "10008422", "Gewerbliches Sozialversicherungsgesetz"),
        Act("BSVG", "10008431", "Bauern-Sozialversicherungsgesetz"),
        Act("B-KUVG", "10008215", "Beamten-Kranken- und Unfallversicherungsgesetz"),
        Act("BPGG", "10008859", "Bundespflegegeldgesetz"),
        Act("FLAG", "10008220", "Familienlastenausgleichsgesetz 1967"),
        Act("KBGG", "20001474", "Kinderbetreuungsgeldgesetz"),
        Act(
            "KUG",
            "10008949",
            "Karenzurlaubszuschußgesetz (Strukturanpassungsgesetz)",
            in_force=False,
        ),
        Act("PFG", "20007381", "Pflegefondsgesetz"),
        Act("SH-GG", "20010649", "Sozialhilfe-Grundsatzgesetz"),
        # related Verordnungen / Kundmachungen
        Act("EinstV", "10009142", "Einstufungsverordnung zum Bundespflegegeldgesetz"),
        Act("Kinder-EinstV", "20009626", "Kinder-Einstufungsverordnung zum Bundespflegegeldgesetz"),
        Act(
            "AufwAnp-2026",
            "20013024",
            "Aufwertung und Anpassung nach dem ASVG, GSVG, BSVG, B-KUVG sowie dem "
            "Bundespflegegeldgesetz für das Kalenderjahr 2026",
        ),
    ]
}

LAWS = ["ASVG", "GSVG", "BSVG", "B-KUVG", "BPGG", "FLAG", "KBGG", "KUG", "PFG", "SH-GG"]
REGULATIONS = ["EinstV", "Kinder-EinstV", "AufwAnp-2026"]
GROUPS: dict[str, list[str]] = {"sv": LAWS + REGULATIONS, "sv-laws": LAWS, "sv-vo": REGULATIONS}


def resolve(spec: str) -> list[Act]:
    """`sv` or a comma-separated list of abbreviations."""
    names: list[str] = []
    for part in spec.split(","):
        part = part.strip()
        names.extend(GROUPS.get(part, [part]))
    unknown = [n for n in names if n not in ACTS]
    if unknown:
        raise SystemExit(f"unknown act(s): {', '.join(unknown)}")
    return [ACTS[n] for n in names]
