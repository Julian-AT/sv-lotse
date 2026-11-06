"""Registered official form templates as dataset inputs.

Two sources, both already in the repository and both read-only here:

* the seven SV-Box AcroForm applications with their catalog schemas
  (`packages/knowledge/forms/svbox-*.json`, assets pinned in `packages/evals/sets/e7/forms.json`);
* the twenty flat SVS forms of the E13 gold set (`packages/evals/sets/e13/gold.json`), whose
  hand-drawn answer areas become `box` fields of a schema exactly as the product stores detected
  fields. Their fact mapping is the dataset's candidate mapping (`e13_mapping.py`).

Licence handling: each template carries its publisher terms. `redistribute_pdf` is true only where
the publisher's terms permit reuse with attribution (SVS, "Werkfreiheit"); SV-Box assets fall under
the challenge terms (FSW and PV terms forbid copying), so their filled PDFs stay local and only the
synthetic field-level gold is publishable.
"""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from datagen.forms.e13_mapping import fact_type_for

REPO = Path(__file__).resolve().parents[3]
FORMS_DIR = REPO / "packages/knowledge/forms"
E7_DIR = REPO / "packages/evals/sets/e7"
E13_DIR = REPO / "packages/evals/sets/e13"
NAMESPACE = uuid.UUID("6f0c1a52-2b1e-4c55-9a51-8a0e5d3c7f10")

SVBOX_TERMS = {
    "oegk": "SV-Box challenge material; ÖGK terms not reviewed for redistribution",
    "pv": "SV-Box challenge material; PV terms limit downloads to personal needs",
    "fsw": "SV-Box challenge material; FSW terms require prior written consent for copying",
    "auva": "SV-Box challenge material; terms not reviewed for redistribution",
}


@dataclass
class Template:
    ref: str  # stable catalog reference (schema id or e13 case id)
    uuid: str  # form_template id used by the product schema
    source: str  # "svbox" | "e13"
    title: str
    publisher: str
    pdf: Path
    sha256: str
    pages: int
    format: str  # "acroform" | "flat"
    status: str
    fields: list[dict]
    attribution: str
    terms: str
    redistribute_pdf: bool
    url: str | None = None
    tags: list[str] = field(default_factory=list)

    def bridge_spec(self) -> dict:
        return {
            "pdf": str(self.pdf),
            "pages": self.pages,
            "status": self.status,
            "fields": self.fields,
        }


def svbox_dir() -> Path:
    env = os.environ.get("SVBOX_DIR")
    if env:
        p = Path(env)
        return p if p.is_absolute() else REPO / p
    return REPO / "data/svbox"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _publisher_key(url: str) -> str:
    for key in ("oegk", "fsw", "pv", "auva"):
        if key in url:
            return key
    return "oegk"


def svbox_templates() -> list[Template]:
    pinned = json.loads((E7_DIR / "forms.json").read_text())
    out = []
    for entry in pinned:
        schema = json.loads((FORMS_DIR / entry["schema"]).read_text())
        pdf = svbox_dir() / entry["path"]
        if not pdf.exists() or _sha256(pdf) != entry["sha256"]:
            raise FileNotFoundError(f"SV-Box asset missing or changed: {entry['path']}")
        source = (schema.get("sources") or [{}])[0]
        pub = _publisher_key(entry["publisher"])
        out.append(
            Template(
                ref=schema["id"],
                uuid=schema["template_id"],
                source="svbox",
                title=Path(entry["path"]).stem,
                publisher=entry["publisher"],
                pdf=pdf,
                sha256=entry["sha256"],
                pages=entry["pages"],
                format="acroform",
                status=schema["status"],
                fields=schema["fields"],
                attribution=f"Formular: {entry['publisher']} (SV-Box der KI-Challenge)",
                terms=SVBOX_TERMS[pub],
                redistribute_pdf=False,
                url=source.get("url"),
                tags=["svbox", f"publisher:{pub}"],
            )
        )
    return out


def _owner_signature(item: dict) -> str:
    return "subject" if item["type"] == "signature" else "none"


def e13_templates() -> list[Template]:
    gold = json.loads((E13_DIR / "gold.json").read_text())
    out = []
    for case in gold["cases"]:
        doc = case["input"]["document"]
        pdf = E13_DIR / doc["path"]
        if _sha256(pdf) != doc["sha256"]:
            raise FileNotFoundError(f"E13 asset changed: {doc['path']}")
        tid = str(uuid.uuid5(NAMESPACE, doc["sha256"]))
        fields = []
        for i, item in enumerate(case["expected"]):
            fid = f"b{i:03d}"
            f = {
                "id": fid,
                "label_de": item["label_de"],
                "type": item["type"],
                "box": item["box"],
                "page": item["box"]["page"],
                "owner": item["owner"],
                "signature": _owner_signature(item),
                "method": "vector",
                "confidence": 1,
                "validation": {},
                "help_text": item["section"],
            }
            fact = fact_type_for(item["label_de"], item["section"], item["type"], item["owner"])
            if fact:
                f["fact_type"] = fact
            fields.append(f)
        title = doc["attribution"].split(". ", 1)[-1]
        out.append(
            Template(
                ref=case["id"],
                uuid=tid,
                source="e13",
                title=title,
                publisher="https://www.svs.at",
                pdf=pdf,
                sha256=doc["sha256"],
                pages=len(doc["pages"]),
                format="flat",
                status="auto",
                fields=fields,
                attribution=doc["attribution"],
                terms=doc["terms"]["passage"],
                redistribute_pdf=True,
                url=doc["url"],
                tags=[t for t in case["tags"] if ":" in t],
            )
        )
    return out


def all_templates() -> list[Template]:
    return svbox_templates() + e13_templates()
