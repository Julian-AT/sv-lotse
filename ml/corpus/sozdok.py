"""LOCAL-only join of SV-Box SozDok law texts onto the RIS corpus.

SozDok content is licensed to challenge participants only. The joined file stays on this machine
(`ml/data/` is gitignored) and is never uploaded; the published corpus contains RIS data only.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pandas as pd

KIND = {"PARA": "PARA", "ART": "ART", "ANL": "ANL"}
_WS = re.compile(r"\s+")


def _parse_name(name: str) -> dict | None:
    # e.g. ASVG=PARA=3=100=2018-12-22=2020-01-01.xml -> act, kind, number, nr, pubdate, in force
    parts = name.removesuffix(".xml").split("=")
    if len(parts) != 6 or parts[1] not in KIND:
        return None
    act, kind, num, _nr, _pub, ikra = parts
    return {"act": act, "key": f"{KIND[kind]}:{num.replace(' ', '').lower()}", "ikra": ikra}


def _text(path: Path) -> str:
    root = ET.parse(path).getroot()
    for meta in root.iter("metadaten"):
        meta.clear()
    for skip in ("uebrecht", "puborgane"):
        for el in root.iter(skip):
            el.clear()
    return _WS.sub(" ", " ".join(root.itertext())).strip()


def join(df: pd.DataFrame, sozdok_dir: Path, out: Path) -> dict:
    """Match by act and paragraph; keep the latest SozDok version in force at `version_as_of`."""
    as_of = str(df["version_as_of"].iloc[0])
    acts = set(df["act"])
    best: dict[tuple[str, str], tuple[str, Path]] = {}
    for path in sozdok_dir.glob("*.xml"):
        info = _parse_name(path.name)
        if not info or info["act"] not in acts or info["ikra"] > as_of:
            continue
        k = (info["act"], info["key"])
        if k not in best or info["ikra"] > best[k][0]:
            best[k] = (info["ikra"], path)
    rows = []
    for rec in df[["doc_id", "act", "paragraph_key"]].itertuples(index=False):
        hit = best.get((rec.act, rec.paragraph_key))
        if hit:
            rows.append(
                {
                    "doc_id": rec.doc_id,
                    "act": rec.act,
                    "paragraph_key": rec.paragraph_key,
                    "sozdok_file": hit[1].name,
                    "sozdok_in_force": hit[0],
                    "sozdok_text": _text(hit[1]),
                }
            )
    local = pd.DataFrame(rows)
    out.parent.mkdir(parents=True, exist_ok=True)
    local.to_parquet(out, compression="zstd", index=False)
    per_act = local.groupby("act").size().to_dict() if len(local) else {}
    return {
        "file": str(out.name),
        "published": False,
        "matched": len(local),
        "per_act": {k: int(v) for k, v in per_act.items()},
    }
