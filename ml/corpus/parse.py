"""Parsers for RIS OGD v2.6 search results and Bundesrecht XML documents."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from typing import Any

NS = "{http://www.bka.gv.at}"
BLOCKS = {
    "absatz", "listelem", "ueberschrift", "td", "th", "schlussteil", "schluss", "inhaltsvz",
}  # fmt: skip
TITLE_TYPES = {"para", "art", "anlage"}
INLINE_REPLACE = [
    (re.compile(r"<gdash\s*/>"), "-"),
    (re.compile(r"<tab\b[^>]*/>"), " "),
    (re.compile(r"<br\s*/>"), "\n"),
    (re.compile(r"</(symbol|gldsym)>"), r"</\1> "),
]
_WS = re.compile(r"[ \t    ]+")


def as_list(value: Any) -> list:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def search_hits(payload: dict) -> tuple[int, list[dict]]:
    results = payload["OgdSearchResult"]["OgdDocumentResults"]
    total = int(results["Hits"]["#text"])
    return total, as_list(results.get("OgdDocumentReference"))


def _content_url(data: dict, kind: str) -> str | None:
    for ref in as_list(data.get("Dokumentliste", {}).get("ContentReference")):
        if ref.get("ContentType") != "MainDocument":
            continue
        for url in as_list(ref.get("Urls", {}).get("ContentUrl")):
            if url.get("DataType") == kind:
                return url.get("Url")
    return None


def reference_meta(ref: dict) -> dict:
    """Flatten one OgdDocumentReference (Applikation BrKons) into corpus metadata."""
    data = ref["Data"]
    meta = data["Metadaten"]
    br = meta["Bundesrecht"]
    kons = br["BrKons"]
    return {
        "doc_id": meta["Technisch"]["ID"],
        "act": kons.get("Abkuerzung") or "",
        "act_title": br.get("Kurztitel") or "",
        "gesetzesnummer": kons.get("Gesetzesnummer") or "",
        "paragraph": (kons.get("ArtikelParagraphAnlage") or "").strip(),
        "doc_type": kons.get("Dokumenttyp") or "",
        "norm_type": kons.get("Typ") or "",
        "valid_from": kons.get("Inkrafttretensdatum"),
        "valid_to": kons.get("Ausserkrafttretensdatum"),
        "promulgation": (kons.get("Kundmachungsorgan") or "").strip(),
        "changed": meta.get("Allgemein", {}).get("Geaendert"),
        "url": br.get("Eli") or meta.get("Allgemein", {}).get("DokumentUrl") or "",
        "xml_url": _content_url(data, "Xml"),
    }


def _text(el: ET.Element) -> str:
    return _WS.sub(" ", "".join(el.itertext())).strip()


def parse_document(xml: str | bytes) -> dict:
    """Extract heading and plain text of the normative part (`ct="text"`) of a BrKons XML."""
    if isinstance(xml, bytes):
        xml = xml.decode("utf-8")
    for pattern, repl in INLINE_REPLACE:
        xml = pattern.sub(repl, xml)
    root = ET.fromstring(xml.encode("utf-8"))
    nutz = root.find(f"{NS}nutzdaten")
    if nutz is None:
        return {"section": "", "title": "", "text": ""}

    section: list[str] = []
    title_parts: list[str] = []
    lines: list[str] = []

    def visit(el: ET.Element) -> None:
        tag = el.tag.removeprefix(NS)
        if tag in {"kzinhalt", "fzinhalt", "layoutdaten"}:
            return
        if tag in BLOCKS and el.get("ct") == "text":
            line = _text(el)
            if line:
                if tag == "ueberschrift" and not lines:
                    (title_parts if el.get("typ") in TITLE_TYPES else section).append(line)
                else:
                    lines.append(line)
            return
        if tag == "tr" and any(c.get("ct") == "text" for c in el.iter() if c is not el):
            cells = [_text(c) for c in el if c.tag.removeprefix(NS) in {"td", "th"}]
            row = " | ".join(c for c in cells if c)
            if row:
                lines.append(row)
            return
        for child in el:
            visit(child)

    visit(nutz)
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return {"section": " / ".join(section), "title": " – ".join(title_parts), "text": text}


_PARA = re.compile(r"^(§|Artikel|Art\.?|Anlage|Anl\.?)\s*(.*)$", re.I)


def paragraph_key(label: str) -> str:
    """Normalise `§ 30c`, `Art. 1`, `Anl. 2` to a join key like `PARA:30c`, `ART:1`, `ANL:2`."""
    m = _PARA.match(label.strip())
    if not m:
        return label.strip().upper()
    kind = {"§": "PARA", "art": "ART", "artikel": "ART", "anl": "ANL", "anlage": "ANL"}[
        m.group(1).rstrip(".").lower()
    ]
    return f"{kind}:{m.group(2).replace(' ', '').lower()}"
